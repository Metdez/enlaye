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

import logging
import os
from typing import Annotated, Any

import pandas as pd
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from supabase import Client, create_client

import cleaning
from models import (
    MINIMUM_TRAINING_SAMPLES,
    InsufficientTrainingData,
    ModelResult,
    train_naive_model,
    train_pre_construction_model,
)

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
