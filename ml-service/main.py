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


def _normalize_storage_path(storage_path: str) -> str:
    """Strip an optional `portfolios-uploads/` prefix from the caller's path.

    WHY: callers vary. The frontend server action mints signed URLs with
    the bare `portfolios/<uuid>/raw.csv` shape, but the Supabase JS
    client's `getPublicUrl` returns paths prefixed with the bucket name.
    We accept both so a working caller doesn't silently 404 because of
    a cosmetic prefix difference.
    """
    # SECURITY: refuse traversal or absolute paths before they reach the
    # storage SDK. The bucket is pinned elsewhere, but a path like
    # `portfolios/../other-thing` can still move the lookup inside the
    # same bucket — and a leading `/` trips the SDK's path parser.
    if ".." in storage_path or storage_path.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "invalid storage_path", "storage_path": storage_path},
        )
    prefix = f"{_STORAGE_BUCKET}/"
    if storage_path.startswith(prefix):
        return storage_path[len(prefix) :]
    return storage_path


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
    object_path = _normalize_storage_path(req.storage_path)
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

    # ---- 4. Delete existing rows for this portfolio (idempotent) ----
    # WHY: delete-then-insert beats upsert here because project_id_external
    # isn't unique across portfolios and we have no natural composite key.
    # WHY: delete-then-insert is idempotent under sequential access only.
    # Two concurrent /ingest calls for the same portfolio_id can interleave
    # and double-insert. Acceptable for MVP (single-user demo mode per
    # ARCHITECTURE.md § Security Model); if we go multi-user we either need
    # a DB-level unique constraint + upsert or to wrap this in a transaction.
    client.table("projects").delete().eq("portfolio_id", portfolio_id).execute()

    # ---- 5. Insert cleaned rows ----
    records = _df_to_records(cleaned_df, portfolio_id)
    if records:
        client.table("projects").insert(records).execute()

    # ---- 6. Update portfolio metadata ----
    anomaly_count = int(sum(1 for flags in cleaned_df["anomaly_flags"] if flags))
    row_count = int(len(cleaned_df))
    # `report` is a TypedDict — a plain dict at runtime, directly jsonb-safe.
    client.table("portfolios").update(
        {
            "row_count": row_count,
            "anomaly_count": anomaly_count,
            "cleaning_report": dict(report),
        }
    ).eq("id", portfolio_id).execute()

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


@app.post("/train", response_model=TrainResponse)
def train(
    req: TrainRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> TrainResponse:
    # TODO(claude): Phase 3 — train naive + pre_construction models, write to model_runs.
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "train not implemented yet")
