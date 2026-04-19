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
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from supabase import Client, create_client

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


@app.post("/ingest", response_model=IngestResponse)
def ingest(
    req: IngestRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> IngestResponse:
    # TODO(claude): Phase 1 — download CSV from Storage, clean, insert into projects.
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "ingest not implemented yet")


@app.post("/train", response_model=TrainResponse)
def train(
    req: TrainRequest,
    _: Annotated[None, Depends(require_internal_token)],
) -> TrainResponse:
    # TODO(claude): Phase 3 — train naive + pre_construction models, write to model_runs.
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "train not implemented yet")
