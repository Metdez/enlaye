"""Enlaye ML service — FastAPI entry point.

Endpoints:
  GET  /health   — Railway health check
  POST /ingest   — stub; Phase 1 implements CSV clean + insert into `projects`
  POST /train    — stub; Phase 3 implements naive vs. pre-construction models

All mutating endpoints require a bearer token that matches INTERNAL_API_TOKEN,
set as a Railway env var and shared with the Next.js frontend API route.
See ARCHITECTURE.md § Security Model.
"""

from __future__ import annotations

import datetime as _dt
import logging
import math
import os
from typing import Annotated, Any, Literal

import pandas as pd
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from supabase import Client, create_client

import cleaning
from drivers import compute_rules
from models import (
    MINIMUM_TRAINING_SAMPLES,
    InsufficientTrainingData,
    ModelResult,
    train_naive_model,
    train_pre_construction_model,
)
from risk import compute_scores
from scenarios import simulate as run_simulation
from segments import compute_segments_df

load_dotenv()

SERVICE_VERSION = "0.0.1"
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

logger = logging.getLogger("enlaye.ml")

# WHY: one module-level client reused across requests. The Supabase Python
# SDK is sync/thread-safe; recreating it per request would add latency for
# no benefit. If either env var is missing we construct None and surface
# that via /health so Railway's probe can catch a misconfigured deploy.
_supabase: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    else None
)


def get_supabase() -> Client:
    if _supabase is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Supabase client not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)",
        )
    return _supabase


app = FastAPI(
    title="Enlaye ML Service",
    version=SERVICE_VERSION,
    description="CSV ingest + dispute-prediction training for the Enlaye dashboard.",
    # SECURITY: disable public API discovery. The Next.js proxy only forwards
    # an allowlist of paths, but leaving /docs, /redoc, /openapi.json on
    # means a future misconfig instantly leaks our API surface.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def require_internal_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Bearer-token gate for cross-service calls.

    WHY: the frontend is the only authorized caller in the MVP; Railway's URL
    is technically public, so we refuse anything without the shared secret.
    """
    if not INTERNAL_API_TOKEN:
        # Explicit fail-closed: if the deploy is missing the secret, don't pretend to work.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_API_TOKEN not configured on the service",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != INTERNAL_API_TOKEN:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid bearer token")


# ---------------------------------------------------------------------------
# Schemas (mirror ARCHITECTURE.md § API Contracts)
# ---------------------------------------------------------------------------


class IngestRequest(BaseModel):
    portfolio_id: str = Field(..., description="UUID of the portfolio")
    storage_path: str = Field(..., description="Supabase Storage path to the raw CSV")


class CleaningReport(BaseModel):
    imputations: list[dict] = Field(default_factory=list)
    type_coercions: list[dict] = Field(default_factory=list)
    rows_rejected: int = 0


class IngestResponse(BaseModel):
    portfolio_id: str
    row_count: int
    cleaning_report: CleaningReport
    anomaly_count: int


class TrainRequest(BaseModel):
    portfolio_id: str


class ModelRunResult(BaseModel):
    model_run_id: str
    accuracy: float
    features_used: list[str]
    feature_importances: dict[str, float]
    n_training_samples: int


class TrainResponse(BaseModel):
    naive: ModelRunResult
    pre_construction: ModelRunResult


class AnalyzeRequest(BaseModel):
    portfolio_id: str = Field(..., description="UUID of the portfolio to recompute")


class AnalyzeResponse(BaseModel):
    portfolio_id: str
    n_projects: int
    n_rules: int


# ---- /simulate schemas ----

# WHY: the request mirrors the four inputs the scenarios.py encoder
# consumes. `k` is capped at 20 because the encoded feature space is
# tiny (≈7 columns for the demo) and larger cohorts dilute the "similar
# projects" signal the UI surfaces; ge=1 so we always return something.
class SimulateRequest(BaseModel):
    portfolio_id: str
    project_type: str
    region: str
    contract_value_usd: float = Field(..., ge=0)
    subcontractor_count: int = Field(..., ge=0)
    k: int = Field(5, ge=1, le=20)


class SimulateOutcomeRange(BaseModel):
    p25: float | None
    p50: float | None
    p75: float | None
    n: int
    confidence: Literal["low", "medium", "high"]


class SimulateOutcomeRate(BaseModel):
    rate: float | None
    ci_low: float
    ci_high: float
    n: int
    confidence: Literal["low", "medium", "high"]


class SimulateOutcomes(BaseModel):
    delay_days: SimulateOutcomeRange
    cost_overrun_pct: SimulateOutcomeRange
    safety_incidents: SimulateOutcomeRange
    any_dispute: SimulateOutcomeRate


class SimulateResponse(BaseModel):
    portfolio_id: str
    cohort_size: int
    k_requested: int
    similar_project_ids: list[str]
    outcomes: SimulateOutcomes
    caveats: list[str]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, object]:
    """Readiness probe: 200 only if the service can reach Postgres.

    WHY: Railway treats /health as readiness. A healthy-looking service
    that can't reach the DB will happily accept ingest requests and
    silently fail on write, so we return 503 and let the platform
    restart or stop routing traffic.
    """
    db_reachable = False
    if _supabase is not None:
        try:
            # Cheapest round-trip the Python SDK supports: select one id row.
            # WHY: the JS SDK has `.select(..., head=true)` to skip the body,
            # but supabase-py (as of 2.9.x) raises TypeError on that kwarg.
            _supabase.table("portfolios").select("id").limit(1).execute()
            db_reachable = True
        except Exception as exc:  # noqa: BLE001 — log anything, still answer the probe
            logger.warning("db_reachable probe failed: %s", exc)
            db_reachable = False

    if not db_reachable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "degraded",
                "version": SERVICE_VERSION,
                "db_reachable": False,
            },
        )

    return {
        "status": "ok",
        "version": SERVICE_VERSION,
        "db_reachable": True,
    }


# ---------------------------------------------------------------------------
# /ingest helpers
# ---------------------------------------------------------------------------

_STORAGE_BUCKET = "portfolios-uploads"

# WHY: these projects-table columns are `int` in Postgres but arrive as
# float64 out of pandas (medians, imputed cells, NaN-friendly dtype). We
# round+cast at the insert boundary so Postgres doesn't 22P02 on "2.0".
# Any None in these columns is preserved as-is (already handled upstream).
# NOTE: keep this in sync with `projects` column types in
# ARCHITECTURE.md § Database Schema. Any new int-typed column must be
# added here, otherwise float medians will land as text in Postgres.
_INT_COLUMNS: frozenset[str] = frozenset(
    {
        "subcontractor_count",
        "safety_incidents",
        "payment_disputes",
        "actual_duration_days",
    }
)


def _canonical_storage_path(portfolio_id: str, storage_path: str) -> str:
    """Validate caller's path against the canonical shape, accept prefix variants.

    WHY: without this check, a caller with two portfolio UUIDs can cross-
    ingest — e.g. POST `{portfolio_id: A, storage_path: portfolios/B/raw.csv}`
    — because the service only verifies that `portfolio_id` exists, not that
    the path belongs to it. We pin the path to `portfolios/<portfolio_id>/raw.csv`
    after stripping an optional bucket prefix, and 400 on any mismatch.
    """
    # SECURITY: refuse traversal or absolute paths before any parsing.
    if ".." in storage_path or storage_path.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "invalid storage_path", "storage_path": storage_path},
        )
    prefix = f"{_STORAGE_BUCKET}/"
    normalized = storage_path[len(prefix) :] if storage_path.startswith(prefix) else storage_path
    expected = f"portfolios/{portfolio_id}/raw.csv"
    if normalized != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "storage_path does not match the canonical shape for this portfolio",
                "expected": expected,
                "got": normalized,
            },
        )
    return normalized


def _df_to_records(df: pd.DataFrame, portfolio_id: str) -> list[dict[str, Any]]:
    """Convert the cleaned DataFrame into JSON-safe insert records.

    WHY: pandas' default `.to_dict("records")` leaks `NaT` / `NaN` /
    `pd.NA` sentinels that the Supabase SDK then serializes as the
    string "NaT" or the JSON number `NaN`, neither of which Postgres
    will accept for a date / numeric column. We normalize to real
    Python `None` (= JSON null) and stringify dates explicitly.
    """
    # astype(object) is required so pandas lets us drop nullable ints /
    # Timestamps into a single object column where `.where(..., None)`
    # can replace NA sentinels uniformly.
    # WHY: compute `.notna()` on the *cast* frame, not the original. For
    # nullable Int64 columns, `astype(object)` keeps `pd.NA` as `pd.NA`
    # (not `None`); if the mask comes from the pre-cast frame it can say
    # "not NA" for a cell that's actually `pd.NA` after the cast, letting
    # the sentinel survive into JSON serialization.
    normalized = df.astype(object)
    normalized = normalized.where(normalized.notna(), None)

    records: list[dict[str, Any]] = []
    for _, row in normalized.iterrows():
        record: dict[str, Any] = {"portfolio_id": portfolio_id}
        for col, value in row.items():
            if value is None:
                record[col] = None
                continue
            if col in ("start_date", "end_date"):
                # Dates land here as pandas Timestamps after coerce_types.
                # ISO-format them for the jsonb-friendly REST API.
                if isinstance(value, pd.Timestamp):
                    record[col] = value.strftime("%Y-%m-%d")
                else:
                    record[col] = str(value)
                continue
            if col == "anomaly_flags":
                # Already a list[str]; the SDK serializes to jsonb.
                record[col] = list(value)
                continue
            # Numeric + text columns: rely on native Python types via
            # the object-cast. Cast numpy scalars defensively.
            if hasattr(value, "item"):
                value = value.item()
            if col in _INT_COLUMNS and value is not None:
                # Medians return floats even for integer columns; round
                # to nearest to avoid 22P02 "invalid syntax for integer".
                record[col] = int(round(float(value)))
                continue
            record[col] = value
        records.append(record)
    return records


@app.post("/ingest", response_model=IngestResponse)
def ingest(
    req: IngestRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> IngestResponse:
    """Download a CSV from Storage, clean it, and populate `projects`.

    Idempotent: re-ingesting the same `portfolio_id` deletes the prior
    project rows first, so running twice yields the same row count —
    not double. See ARCHITECTURE.md § Data Flow Diagrams (CSV Upload).
    """
    client = get_supabase()
    portfolio_id = req.portfolio_id

    # SECURITY: log the portfolio_id only — never the storage path's raw
    # bytes or any cell values. storage_path itself is user-influenced
    # but non-sensitive (it's a UUID folder), so we include it for ops.
    logger.info("ingest.start portfolio_id=%s", portfolio_id)

    # ---- 1. Portfolio must exist ----
    portfolio_row = (
        client.table("portfolios").select("id").eq("id", portfolio_id).limit(1).execute()
    )
    if not portfolio_row.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "portfolio not found", "portfolio_id": portfolio_id},
        )

    # ---- 2. Download CSV from Storage ----
    # WHY: the canonical check pins the path to this portfolio so a caller
    # with two portfolio UUIDs can't cross-ingest another portfolio's file.
    object_path = _canonical_storage_path(portfolio_id, req.storage_path)
    try:
        raw_bytes: bytes = client.storage.from_(_STORAGE_BUCKET).download(object_path)
    except Exception as exc:  # noqa: BLE001 — SDK raises a variety of subclasses
        # WHY: we log the exception message but NOT bearer tokens or keys.
        # The exception from the storage SDK is a generic StorageApiError
        # that includes the requested path; that's fine to surface.
        logger.warning(
            "ingest.storage_download_failed portfolio_id=%s error=%s",
            portfolio_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": "csv not found at storage_path",
                "storage_path": req.storage_path,
            },
        ) from exc

    # ---- 3. Clean ----
    try:
        cleaned_df, report = cleaning.clean(raw_bytes)
    except ValueError as exc:
        # `parse_csv` raises ValueError for missing required columns.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "malformed CSV", "details": str(exc)},
        ) from exc
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
        # WHY: pandas raises these when the payload isn't CSV-shaped
        # (binary file, empty file, jagged rows). Surface as 400 so the
        # client gets an actionable error instead of a generic 500.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "malformed CSV", "details": str(exc)},
        ) from exc
    except UnicodeDecodeError as exc:
        # Non-UTF-8 byte payload — same user-facing class of error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "malformed CSV",
                "details": f"file is not valid UTF-8: {exc}",
            },
        ) from exc

    # ---- 4..6. Delete / insert / update with metadata-state recovery ----
    # WHY: the three writes aren't wrapped in a transaction (supabase-py
    # doesn't expose one over the REST API). If insert or the portfolio
    # metadata update fails mid-way, the DB can end up with projects rows
    # that don't match portfolios.row_count/anomaly_count. We can't undo
    # the delete/insert cheaply, but we CAN snapshot the prior portfolio
    # metadata up front and restore it on failure so at least the summary
    # row reflects reality (a follow-up ingest will then set it correctly).
    # Tracked for a proper transaction/RPC fix when we go multi-user —
    # see ARCHITECTURE.md § Security Model.
    metadata_snapshot = (
        client.table("portfolios")
        .select("row_count, anomaly_count, cleaning_report")
        .eq("id", portfolio_id)
        .limit(1)
        .execute()
    )
    snapshot = metadata_snapshot.data[0] if metadata_snapshot.data else None

    records = _df_to_records(cleaned_df, portfolio_id)
    anomaly_count = int(sum(1 for flags in cleaned_df["anomaly_flags"] if flags))
    row_count = int(len(cleaned_df))

    try:
        client.table("projects").delete().eq("portfolio_id", portfolio_id).execute()
        if records:
            client.table("projects").insert(records).execute()
        # `report` is a TypedDict — a plain dict at runtime, directly jsonb-safe.
        client.table("portfolios").update(
            {
                "row_count": row_count,
                "anomaly_count": anomaly_count,
                "cleaning_report": dict(report),
            }
        ).eq("id", portfolio_id).execute()
    except Exception:  # noqa: BLE001 — any DB failure during the write trio
        # Best-effort recovery: restore portfolio metadata to its pre-ingest
        # snapshot so the UI doesn't show stale counts. Projects rows may
        # still be in an inconsistent state; the next ingest will rebuild.
        logger.exception(
            "ingest.write_failed portfolio_id=%s — attempting metadata rollback",
            portfolio_id,
        )
        if snapshot is not None:
            try:
                client.table("portfolios").update(snapshot).eq(
                    "id", portfolio_id
                ).execute()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "ingest.rollback_failed portfolio_id=%s", portfolio_id
                )
        raise

    logger.info(
        "ingest.done portfolio_id=%s row_count=%d anomaly_count=%d",
        portfolio_id,
        row_count,
        anomaly_count,
    )

    return IngestResponse(
        portfolio_id=portfolio_id,
        row_count=row_count,
        cleaning_report=CleaningReport(**report),
        anomaly_count=anomaly_count,
    )


# ---------------------------------------------------------------------------
# /train helpers
# ---------------------------------------------------------------------------

# WHY: these are the exact columns `cleaning.clean()` writes to `projects`
# (see cleaning.py § target_cols). We reconstruct the DataFrame for training
# by selecting the same set from Postgres. Keep in lockstep with cleaning.py.
_PROJECT_FETCH_COLUMNS: tuple[str, ...] = (
    "project_id_external",
    "project_name",
    "project_type",
    "contract_value_usd",
    "start_date",
    "end_date",
    "region",
    "subcontractor_count",
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "payment_disputes",
    "final_status",
    "actual_duration_days",
    "anomaly_flags",
)


def _records_to_training_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    """Reconstruct the post-cleaning DataFrame shape expected by models.py.

    WHY: Postgres returns ISO date strings for `date` columns and jsonb
    arrays as Python lists. `cleaning.clean()` left start_date/end_date as
    pandas Timestamps and `anomaly_flags` as list[str]; the training code
    was authored against that shape, so we re-hydrate dates here.
    """
    df = pd.DataFrame.from_records(records)
    # Empty frames still need the expected columns so models.py can run its
    # "insufficient data" check against a real shape instead of KeyError-ing.
    for col in _PROJECT_FETCH_COLUMNS:
        if col not in df.columns:
            df[col] = pd.Series(dtype="object")
    for col in ("start_date", "end_date"):
        df[col] = pd.to_datetime(df[col], errors="coerce")
    return df[list(_PROJECT_FETCH_COLUMNS)]


def _model_result_to_insert_row(
    portfolio_id: str, model_type: str, result: ModelResult
) -> dict[str, Any]:
    """Coerce a ModelResult into a `model_runs` insert record.

    WHY: keep the boundary mapping in one place so the column names /
    Postgres types stay in lockstep with the migration's check constraint
    and jsonb/text[] columns.
    """
    return {
        "portfolio_id": portfolio_id,
        "model_type": model_type,
        "accuracy": float(result["accuracy"]),
        "feature_importances": dict(result["feature_importances"]),
        "features_used": list(result["features_used"]),
        "n_training_samples": int(result["n_training_samples"]),
    }


# ---------------------------------------------------------------------------
# /train
# ---------------------------------------------------------------------------

# WHY: /train is the *showcase* of the Enlaye assessment. It deliberately
# trains two models on the same data:
#   - `naive`: uses every numeric feature, including post-construction
#     outcomes like `delay_days`, `cost_overrun_pct`, `safety_incidents`,
#     `actual_duration_days`. These leak the label — a "disputed" project
#     is almost definitionally one that ran late or over budget — and the
#     naive model will look great in-sample while being useless for the
#     one thing the user actually wants (pre-construction risk scoring).
#   - `pre_construction`: restricted to features known BEFORE a shovel
#     hits dirt — contract value, region, project_type, subcontractor_count,
#     etc. Honest signal, lower accuracy, the model a real risk analyst
#     would deploy.
# The side-by-side comparison is the point. See CLAUDE.md § Critical
# Non-Negotiables #4 — do NOT merge these into a single model.
#
# Idempotency: like /ingest, we delete any prior model_runs rows for this
# portfolio before inserting, so re-calling /train gives exactly two rows
# (one per model_type). Prior rows are snapshotted first for best-effort
# restore on write failure — same pattern as the /ingest metadata rollback.


@app.post("/train", response_model=TrainResponse)
def train(
    req: TrainRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> TrainResponse:
    """Train naive + pre_construction dispute models, persist to model_runs."""
    client = get_supabase()
    portfolio_id = req.portfolio_id

    logger.info("train.start portfolio_id=%s", portfolio_id)

    # ---- 1. Portfolio must exist ----
    portfolio_row = (
        client.table("portfolios").select("id").eq("id", portfolio_id).limit(1).execute()
    )
    if not portfolio_row.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "portfolio not found", "portfolio_id": portfolio_id},
        )

    # ---- 2. Fetch projects rows ----
    projects_resp = (
        client.table("projects")
        .select(",".join(_PROJECT_FETCH_COLUMNS))
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    records: list[dict[str, Any]] = list(projects_resp.data or [])

    # ---- 3. Reconstruct DataFrame shape models.py expects ----
    df = _records_to_training_frame(records)

    # ---- 4. Train both models ----
    # WHY: naive first so a catastrophic failure there doesn't leave the
    # user with a half-populated model_runs table after we've already
    # written the pre_construction row.
    try:
        naive_result = train_naive_model(df)
        pre_construction_result = train_pre_construction_model(df)
    except InsufficientTrainingData as exc:
        logger.info(
            "train.insufficient_data portfolio_id=%s n_completed=%d",
            portfolio_id,
            exc.n_completed_projects,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "insufficient training data",
                "n_completed_projects": exc.n_completed_projects,
                "minimum_required": MINIMUM_TRAINING_SAMPLES,
            },
        ) from exc

    # ---- 5. Persist: snapshot, delete prior runs, insert two rows ----
    # WHY: supabase-py has no transaction API over REST, so the same
    # snapshot-and-rollback pattern /ingest uses is our best-effort guard
    # against partial writes. model_runs is small (2 rows per portfolio)
    # so snapshotting is effectively free.
    snapshot_resp = (
        client.table("model_runs")
        .select(
            "portfolio_id, model_type, accuracy, feature_importances, "
            "features_used, n_training_samples"
        )
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    snapshot_rows: list[dict[str, Any]] = list(snapshot_resp.data or [])

    insert_rows = [
        _model_result_to_insert_row(portfolio_id, "naive", naive_result),
        _model_result_to_insert_row(
            portfolio_id, "pre_construction", pre_construction_result
        ),
    ]

    try:
        client.table("model_runs").delete().eq("portfolio_id", portfolio_id).execute()
        client.table("model_runs").insert(insert_rows).execute()
    except Exception:  # noqa: BLE001 — any DB failure during write
        logger.exception(
            "train.write_failed portfolio_id=%s — attempting rollback",
            portfolio_id,
        )
        if snapshot_rows:
            try:
                # Best-effort: re-insert the prior rows so the UI doesn't
                # see an empty model_runs for this portfolio. Re-inserts
                # get fresh `id`/`created_at` — acceptable for recovery.
                client.table("model_runs").insert(snapshot_rows).execute()
            except Exception:  # noqa: BLE001
                logger.exception(
                    "train.rollback_failed portfolio_id=%s", portfolio_id
                )
        raise

    # ---- 6. Read back the inserted rows to get Postgres-generated ids ----
    # WHY: we can't trust the insert response shape across supabase-py
    # versions for ordering, so fetch explicitly and key by model_type.
    readback = (
        client.table("model_runs")
        .select("id, model_type")
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    by_type: dict[str, str] = {
        row["model_type"]: row["id"] for row in (readback.data or [])
    }
    if "naive" not in by_type or "pre_construction" not in by_type:
        # Shouldn't happen — we just inserted both — but fail loudly if so.
        logger.error(
            "train.readback_missing portfolio_id=%s found=%s",
            portfolio_id,
            list(by_type),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "failed to read back inserted model_runs"},
        )

    logger.info(
        "train.done portfolio_id=%s naive_acc=%.3f pre_construction_acc=%.3f "
        "n_samples=%d",
        portfolio_id,
        float(naive_result["accuracy"]),
        float(pre_construction_result["accuracy"]),
        int(naive_result["n_training_samples"]),
    )

    return TrainResponse(
        naive=ModelRunResult(
            model_run_id=by_type["naive"],
            accuracy=float(naive_result["accuracy"]),
            features_used=list(naive_result["features_used"]),
            feature_importances=dict(naive_result["feature_importances"]),
            n_training_samples=int(naive_result["n_training_samples"]),
        ),
        pre_construction=ModelRunResult(
            model_run_id=by_type["pre_construction"],
            accuracy=float(pre_construction_result["accuracy"]),
            features_used=list(pre_construction_result["features_used"]),
            feature_importances=dict(
                pre_construction_result["feature_importances"]
            ),
            n_training_samples=int(pre_construction_result["n_training_samples"]),
        ),
    )


# ---------------------------------------------------------------------------
# /analyze — risk intelligence refresh
# ---------------------------------------------------------------------------

# WHY: /analyze orchestrates the three pure-function modules (segments,
# risk, drivers) and materialises their outputs into `project_segments`,
# `risk_scores`, and `heuristic_rules`. Idempotent: each call deletes the
# portfolio's existing rows in all three tables before inserting fresh
# ones. supabase-py doesn't expose real transactions; if a mid-way write
# fails we log and re-raise so the caller sees a 500 and can retry.
# At 10k+ rows this will need to move off the write path (job queue or
# scheduled task); see the phase plan's risks section.
# TODO(claude): move off the request path when row_count > ~5k.

# WHY: these are the columns the risk + segments + drivers modules read
# from the raw row dicts. Keep in sync with the SELECT below — adding a
# new feature to any of the three modules means adding its source column
# here so the in-memory DataFrame has it.
_ANALYZE_FETCH_COLUMNS: tuple[str, ...] = (
    "id",
    "project_id_external",
    "portfolio_id",
    "project_type",
    "contract_value_usd",
    "start_date",
    "end_date",
    "region",
    "subcontractor_count",
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "payment_disputes",
    "final_status",
    "actual_duration_days",
    "anomaly_flags",
)


def _records_to_analyze_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    """Build a DataFrame with the shape the analyze pipeline expects.

    Mirrors `_records_to_training_frame` but for the analyze column set.
    WHY separate: /train and /analyze each pin their own column list so
    changes to one don't silently widen the other's contract.
    """
    df = pd.DataFrame.from_records(records)
    for col in _ANALYZE_FETCH_COLUMNS:
        if col not in df.columns:
            df[col] = pd.Series(dtype="object")
    for col in ("start_date", "end_date"):
        df[col] = pd.to_datetime(df[col], errors="coerce")
    # Numeric columns come back from Postgres as Python ints / floats /
    # None; pandas infers object dtype on mixed None+int. Coerce the
    # ones the modules do arithmetic on so NaN-propagation works.
    for col in (
        "contract_value_usd",
        "subcontractor_count",
        "delay_days",
        "cost_overrun_pct",
        "safety_incidents",
        "payment_disputes",
        "actual_duration_days",
    ):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df[list(_ANALYZE_FETCH_COLUMNS)]


def _jsonable(value: Any) -> Any:
    """Coerce pandas / numpy scalars into JSON-safe Python primitives.

    WHY: numpy's int64 / float64 survive dict construction but trip up
    the Supabase REST serializer with TypeError. Same deal with pandas'
    NA sentinel. One shared helper keeps the insert builders clean.
    """
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if pd.isna(value) is True:  # covers pd.NA, NaT, np.nan uniformly
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def _analyze_portfolio(client: Client, portfolio_id: str) -> AnalyzeResponse:
    """Internal analyze helper — reused by /analyze and the 8c mutation endpoints.

    WHY: /projects/upsert and /projects/delete need to refresh the three
    derived tables after a write. Hitting the HTTP endpoint internally
    would add a round-trip, double-audit the bearer token, and make unit
    testing gnarlier. Extracting the body into one function keeps the
    /analyze response contract intact while letting feedback-loop writes
    call the same code path in-process.
    """
    logger.info("analyze.start portfolio_id=%s", portfolio_id)

    # ---- 1. Load projects ----
    projects_resp = (
        client.table("projects")
        .select(",".join(_ANALYZE_FETCH_COLUMNS))
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    records: list[dict[str, Any]] = list(projects_resp.data or [])

    # Empty portfolio is a valid state (freshly created, not yet ingested).
    # Clear the derived tables so a stale prior run doesn't linger.
    if not records:
        try:
            client.table("risk_scores").delete().eq("portfolio_id", portfolio_id).execute()
            client.table("project_segments").delete().eq(
                "portfolio_id", portfolio_id
            ).execute()
            client.table("heuristic_rules").delete().eq(
                "portfolio_id", portfolio_id
            ).execute()
        except Exception:  # noqa: BLE001
            logger.exception(
                "analyze.cleanup_failed portfolio_id=%s (empty portfolio)",
                portfolio_id,
            )
        return AnalyzeResponse(portfolio_id=portfolio_id, n_projects=0, n_rules=0)

    df = _records_to_analyze_frame(records)

    # ---- 2. Compute segments → risk → rules ----
    try:
        segments_df = compute_segments_df(df)
        score_rows = compute_scores(df)
        rule_rows = compute_rules(df, segments_df)
    except Exception:  # noqa: BLE001 — surface as 500 so client can retry
        logger.exception("analyze.compute_failed portfolio_id=%s", portfolio_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "risk analysis failed"},
        )

    # ---- 3. Build insert records ----
    segment_records: list[dict[str, Any]] = []
    for _, row in segments_df.iterrows():
        segment_records.append(
            {
                "project_id": _jsonable(row["project_id"]),
                "portfolio_id": portfolio_id,
                "size_bucket": str(row["size_bucket"]),
                "normalized_delay": _jsonable(row["normalized_delay"]),
                "cluster_id": _jsonable(row["cluster_id"]),
            }
        )

    score_records: list[dict[str, Any]] = [
        {
            "project_id": _jsonable(row["project_id"]),
            "portfolio_id": portfolio_id,
            "score": int(row["score"]),
            "breakdown": row["breakdown"],
        }
        for row in score_rows
    ]

    rule_records: list[dict[str, Any]] = [
        {"portfolio_id": portfolio_id, **rule} for rule in rule_rows
    ]

    # ---- 4. Idempotent replace: delete then insert ----
    # WHY delete-before-insert rather than ON CONFLICT: `heuristic_rules`
    # has no unique key (scope+outcome could theoretically repeat if the
    # rule set expands), and delete+insert keeps all three tables on the
    # same refresh semantics. Best-effort consistency — if the delete
    # succeeds and the insert fails, the portfolio ends up with zero
    # derived rows until the next /analyze call.
    try:
        client.table("risk_scores").delete().eq("portfolio_id", portfolio_id).execute()
        client.table("project_segments").delete().eq(
            "portfolio_id", portfolio_id
        ).execute()
        client.table("heuristic_rules").delete().eq(
            "portfolio_id", portfolio_id
        ).execute()
        if segment_records:
            client.table("project_segments").insert(segment_records).execute()
        if score_records:
            client.table("risk_scores").insert(score_records).execute()
        if rule_records:
            client.table("heuristic_rules").insert(rule_records).execute()
    except Exception:  # noqa: BLE001
        logger.exception("analyze.write_failed portfolio_id=%s", portfolio_id)
        raise

    logger.info(
        "analyze.done portfolio_id=%s n_projects=%d n_rules=%d",
        portfolio_id,
        len(score_records),
        len(rule_records),
    )

    return AnalyzeResponse(
        portfolio_id=portfolio_id,
        n_projects=len(score_records),
        n_rules=len(rule_records),
    )


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(
    req: AnalyzeRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> AnalyzeResponse:
    """Recompute segments → risk → driver rules for one portfolio.

    Idempotent: re-running on the same portfolio replaces the previous
    rows in `project_segments`, `risk_scores`, and `heuristic_rules`.
    """
    client = get_supabase()
    return _analyze_portfolio(client, req.portfolio_id)


# ---------------------------------------------------------------------------
# /simulate — cohort-based scenario simulator (Phase 8b)
# ---------------------------------------------------------------------------

# WHY: /simulate is a pure read path — no writes, no derived-table
# refresh. It finds the K nearest real projects (by cosine distance in
# the same feature space /analyze's KMeans uses) and returns their
# outcome distributions as P25/P50/P75 ranges plus Wilson CIs. The UI
# presents these explicitly as "ranges over similar projects", NOT as
# predictions — see scenarios.py module docstring for the design stance.


@app.post("/simulate", response_model=SimulateResponse)
def simulate_endpoint(
    req: SimulateRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> SimulateResponse:
    """Run the cohort simulator for a hypothetical project.

    Flow:
      1. Bearer auth (dependency).
      2. Load the portfolio's projects.
      3. If empty → return a valid empty-cohort response with caveats.
      4. Otherwise call scenarios.simulate and wrap the dict into the
         Pydantic response model.
    """
    client = get_supabase()
    portfolio_id = req.portfolio_id

    logger.info(
        "simulate.start portfolio_id=%s type=%s region=%s k=%d",
        portfolio_id,
        req.project_type,
        req.region,
        req.k,
    )

    # ---- 1. Portfolio must exist ----
    portfolio_row = (
        client.table("portfolios").select("id").eq("id", portfolio_id).limit(1).execute()
    )
    if not portfolio_row.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "portfolio not found", "portfolio_id": portfolio_id},
        )

    # ---- 2. Load projects (reuse the analyze column set + frame builder) ----
    projects_resp = (
        client.table("projects")
        .select(",".join(_ANALYZE_FETCH_COLUMNS))
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    records: list[dict[str, Any]] = list(projects_resp.data or [])

    query: dict[str, Any] = {
        "project_type": req.project_type,
        "region": req.region,
        "contract_value_usd": float(req.contract_value_usd),
        "subcontractor_count": int(req.subcontractor_count),
    }

    # ---- 3. Empty portfolio → valid empty-cohort response ----
    # WHY: we still return 200 rather than 404 because "no cohort" is a
    # legitimate state for a freshly-created portfolio — the UI will
    # render the "upload a CSV first" caveat instead of an error toast.
    if not records:
        empty_outcome_range = SimulateOutcomeRange(
            p25=None, p50=None, p75=None, n=0, confidence="low"
        )
        return SimulateResponse(
            portfolio_id=portfolio_id,
            cohort_size=0,
            k_requested=req.k,
            similar_project_ids=[],
            outcomes=SimulateOutcomes(
                delay_days=empty_outcome_range,
                cost_overrun_pct=empty_outcome_range,
                safety_incidents=empty_outcome_range,
                any_dispute=SimulateOutcomeRate(
                    rate=None, ci_low=0.0, ci_high=0.0, n=0, confidence="low"
                ),
            ),
            caveats=[
                "No similar projects in this portfolio — no cohort to draw from.",
            ],
        )

    df = _records_to_analyze_frame(records)

    # ---- 4. Run the simulator ----
    try:
        payload = run_simulation(df, query, k=req.k)
    except Exception:  # noqa: BLE001 — any compute failure surfaces as 500
        logger.exception("simulate.compute_failed portfolio_id=%s", portfolio_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "scenario simulation failed"},
        )

    # ---- 5. Wrap into typed response ----
    outcomes_raw = payload["outcomes"]
    response = SimulateResponse(
        portfolio_id=portfolio_id,
        cohort_size=int(payload["cohort_size"]),
        k_requested=int(payload["k_requested"]),
        similar_project_ids=list(payload["similar_project_ids"]),
        outcomes=SimulateOutcomes(
            delay_days=SimulateOutcomeRange(**outcomes_raw["delay_days"]),
            cost_overrun_pct=SimulateOutcomeRange(**outcomes_raw["cost_overrun_pct"]),
            safety_incidents=SimulateOutcomeRange(**outcomes_raw["safety_incidents"]),
            any_dispute=SimulateOutcomeRate(**outcomes_raw["any_dispute"]),
        ),
        caveats=list(payload["caveats"]),
    )

    logger.info(
        "simulate.done portfolio_id=%s cohort_size=%d",
        portfolio_id,
        response.cohort_size,
    )
    return response


# ---------------------------------------------------------------------------
# /projects/upsert + /projects/delete — feedback loop (Phase 8c)
# ---------------------------------------------------------------------------

# WHY: 8c introduces UI-driven add/edit/delete for projects. Every write
# is followed by an in-process analyze() call so risk_scores,
# project_segments, and heuristic_rules reflect reality before the UI
# re-renders. No pg_net trigger — the prior OOM incident on `documents`
# is recent, and analyze() is cheap at demo scale (15–150 rows).


# Columns that are explicitly allowed to come in as "user-editable" on
# a manual upsert. Kept in sync with the `projects` schema in
# ARCHITECTURE.md § Database Schema — `id`, `portfolio_id`, `source`,
# and `created_at` are server-owned and never accepted from the client.
_UPSERT_INPUT_COLUMNS: tuple[str, ...] = (
    "project_id_external",
    "project_name",
    "project_type",
    "contract_value_usd",
    "start_date",
    "end_date",
    "region",
    "subcontractor_count",
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "payment_disputes",
    "final_status",
    "actual_duration_days",
    "anomaly_flags",
)


class ProjectUpsertInput(BaseModel):
    # WHY: every numeric / text field is Optional because partial updates
    # and manual entry with missing fields are explicit use cases. The
    # one required field is `project_id_external` — it's the dedupe key
    # when no `id` is supplied.
    id: str | None = None
    project_id_external: str
    project_name: str | None = None
    project_type: str | None = None
    contract_value_usd: float | None = Field(default=None, ge=0)
    start_date: str | None = None
    end_date: str | None = None
    region: str | None = None
    subcontractor_count: int | None = Field(default=None, ge=0)
    delay_days: float | None = None
    cost_overrun_pct: float | None = None
    safety_incidents: int | None = Field(default=None, ge=0)
    payment_disputes: int | None = Field(default=None, ge=0)
    final_status: Literal["Completed", "In Progress"] | None = None
    actual_duration_days: int | None = Field(default=None, ge=0)
    anomaly_flags: list[str] = Field(default_factory=list)

    # WHY: FastAPI would otherwise accept any string and the DB cast to
    # `date` would throw a generic 500. Validating here gives a 422 with
    # a clear message pointing at the offending field.
    @field_validator("start_date", "end_date")
    @classmethod
    def _validate_iso_date(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        try:
            _dt.date.fromisoformat(v)
        except ValueError as exc:
            raise ValueError(f"must be ISO yyyy-mm-dd, got {v!r}") from exc
        return v


class ProjectUpsertRequest(BaseModel):
    portfolio_id: str
    project: ProjectUpsertInput


class ProjectUpsertResponse(BaseModel):
    project: dict
    analyze: AnalyzeResponse


class ProjectDeleteRequest(BaseModel):
    portfolio_id: str
    project_id: str  # projects.id UUID


class ProjectDeleteResponse(BaseModel):
    deleted_id: str
    analyze: AnalyzeResponse


def _compute_actual_duration_days(
    start_date: str | None, end_date: str | None
) -> int | None:
    """Mirror cleaning.coerce_types' derivation of actual_duration_days.

    WHY: on manual entry we don't run the full clean() pipeline; we
    reproduce the one derived field it computes so manual rows have
    parity with CSV-ingested rows in the risk/drivers modules. Returns
    None when either date is missing or unparseable — same semantic as
    the Int64 <NA> cleaning.py emits for in-progress projects.
    """
    if not start_date or not end_date:
        return None
    try:
        start = _dt.date.fromisoformat(start_date)
        end = _dt.date.fromisoformat(end_date)
    except ValueError:
        return None
    return (end - start).days


def _project_input_to_row(
    portfolio_id: str,
    project: ProjectUpsertInput,
    *,
    source: str,
) -> dict[str, Any]:
    """Build the dict we'll hand to Supabase INSERT / UPDATE.

    Caller sets `source`:
      - 'manual' on INSERT
      - the preserved existing value on UPDATE

    `id` is intentionally excluded — INSERTs let Postgres generate one;
    UPDATEs use `.eq("id", ...)` to target the row.
    """
    row: dict[str, Any] = {"portfolio_id": portfolio_id, "source": source}
    for col in _UPSERT_INPUT_COLUMNS:
        row[col] = getattr(project, col)

    # WHY: even if the caller sent an explicit actual_duration_days,
    # recompute from the supplied dates so the derived field can't drift
    # from its inputs. If dates are absent and the caller sent a manual
    # value, keep theirs — it's the only signal we have.
    computed = _compute_actual_duration_days(project.start_date, project.end_date)
    if computed is not None:
        row["actual_duration_days"] = computed
    return row


@app.post("/projects/upsert", response_model=ProjectUpsertResponse)
def projects_upsert(
    req: ProjectUpsertRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> ProjectUpsertResponse:
    """Insert or update a single project row, then recompute analytics.

    Resolution order:
      1. If `project.id` is provided → UPDATE by id.
      2. Else look up `(portfolio_id, project_id_external)` → UPDATE if found.
      3. Else INSERT a new row with `source='manual'`.

    On UPDATE the existing `source` is preserved so CSV-ingested rows
    edited from the UI stay tagged 'csv'.
    """
    client = get_supabase()
    portfolio_id = req.portfolio_id
    project = req.project

    logger.info(
        "projects_upsert.start portfolio_id=%s project_id_external=%s id=%s",
        portfolio_id,
        project.project_id_external,
        project.id,
    )

    # ---- 1. Portfolio must exist ----
    portfolio_row = (
        client.table("portfolios").select("id").eq("id", portfolio_id).limit(1).execute()
    )
    if not portfolio_row.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "portfolio not found", "portfolio_id": portfolio_id},
        )

    # ---- 2. Resolve target row ----
    existing: dict[str, Any] | None = None
    if project.id:
        lookup = (
            client.table("projects")
            .select("id, source, portfolio_id")
            .eq("id", project.id)
            .limit(1)
            .execute()
        )
        if not lookup.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": "project not found", "project_id": project.id},
            )
        existing = lookup.data[0]
        # WHY: guard against cross-portfolio update — id is unique but
        # the caller might have mis-wired the portfolio_id.
        if existing["portfolio_id"] != portfolio_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "project belongs to a different portfolio",
                    "project_id": project.id,
                },
            )
    else:
        lookup = (
            client.table("projects")
            .select("id, source")
            .eq("portfolio_id", portfolio_id)
            .eq("project_id_external", project.project_id_external)
            .limit(1)
            .execute()
        )
        if lookup.data:
            existing = lookup.data[0]

    # ---- 3. Write ----
    # WHY: on UPDATE we preserve existing `source` so CSV-origin rows
    # stay 'csv' even after edits. Only fresh INSERTs get 'manual'.
    if existing is not None:
        target_source = existing.get("source") or "csv"
        row = _project_input_to_row(portfolio_id, project, source=target_source)
        try:
            resp = (
                client.table("projects")
                .update(row)
                .eq("id", existing["id"])
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "projects_upsert.update_failed portfolio_id=%s id=%s",
                portfolio_id,
                existing["id"],
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "project update failed"},
            ) from exc
        stored = (resp.data or [None])[0]
        if stored is None:
            # Some supabase-py versions return [] from update; re-select.
            readback = (
                client.table("projects")
                .select("*")
                .eq("id", existing["id"])
                .limit(1)
                .execute()
            )
            stored = (readback.data or [None])[0]
        stored_id = existing["id"]
    else:
        row = _project_input_to_row(portfolio_id, project, source="manual")
        try:
            resp = client.table("projects").insert(row).execute()
        except Exception as exc:  # noqa: BLE001
            # WHY: the only expected failure class here is a unique-constraint
            # violation on (portfolio_id, project_id_external). We surface that
            # as 409 so the UI can tell the user without a stack trace.
            logger.warning(
                "projects_upsert.insert_failed portfolio_id=%s ext=%s err=%s",
                portfolio_id,
                project.project_id_external,
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "could not insert project (duplicate or DB error)",
                    "project_id_external": project.project_id_external,
                    "details": str(exc),
                },
            ) from exc
        stored = (resp.data or [None])[0]
        stored_id = stored["id"] if stored and "id" in stored else None

    # ---- 4. Refresh analytics ----
    # WHY: the contract requires analyze to be present in the response,
    # so a compute failure after the successful write is a 500 — but we
    # include stored_id in the body so the UI can refresh-and-recover
    # and show the user the row they just created.
    try:
        analyze_result = _analyze_portfolio(client, portfolio_id)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "projects_upsert.analyze_failed portfolio_id=%s id=%s",
            portfolio_id,
            stored_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "analyze failed after project write",
                "project_id": stored_id,
                "details": str(exc),
            },
        ) from exc

    logger.info(
        "projects_upsert.done portfolio_id=%s id=%s inserted=%s",
        portfolio_id,
        stored_id,
        existing is None,
    )

    return ProjectUpsertResponse(project=dict(stored or {}), analyze=analyze_result)


@app.post("/projects/delete", response_model=ProjectDeleteResponse)
def projects_delete(
    req: ProjectDeleteRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> ProjectDeleteResponse:
    """Delete a single project, then recompute analytics.

    FK cascades wipe risk_scores + project_segments for the row;
    heuristic_rules are regenerated portfolio-wide by analyze().
    """
    client = get_supabase()
    portfolio_id = req.portfolio_id
    project_id = req.project_id

    logger.info(
        "projects_delete.start portfolio_id=%s project_id=%s",
        portfolio_id,
        project_id,
    )

    # ---- 1. Verify ownership ----
    lookup = (
        client.table("projects")
        .select("id, portfolio_id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not lookup.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "project not found", "project_id": project_id},
        )
    if lookup.data[0]["portfolio_id"] != portfolio_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "project belongs to a different portfolio",
                "project_id": project_id,
            },
        )

    # ---- 2. Delete (AND both conditions — defense in depth) ----
    try:
        (
            client.table("projects")
            .delete()
            .eq("id", project_id)
            .eq("portfolio_id", portfolio_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "projects_delete.failed portfolio_id=%s project_id=%s",
            portfolio_id,
            project_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "project delete failed"},
        ) from exc

    # ---- 3. Refresh analytics ----
    try:
        analyze_result = _analyze_portfolio(client, portfolio_id)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "projects_delete.analyze_failed portfolio_id=%s project_id=%s",
            portfolio_id,
            project_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "analyze failed after project delete",
                "project_id": project_id,
                "details": str(exc),
            },
        ) from exc

    logger.info(
        "projects_delete.done portfolio_id=%s project_id=%s",
        portfolio_id,
        project_id,
    )

    return ProjectDeleteResponse(deleted_id=project_id, analyze=analyze_result)
