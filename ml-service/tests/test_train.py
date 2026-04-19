"""
Tests for POST /train — Phase 3.

Mirrors the pattern in tests/test_ingest.py: env-bootstrap BEFORE importing
`main`, session-scoped reset, a TestClient against the real local Supabase
stack on 127.0.0.1:54321.

These tests seed `projects` rows directly via the service-role client
(bypassing /ingest) so the train path is exercised in isolation. The
15-row `data/projects.csv` fixture runs through `cleaning.clean()` to
produce the exact DataFrame shape /train will later re-hydrate from
Postgres — this keeps the fixture honest with the real data flow.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any

import pytest


# ---------------------------------------------------------------------
# 0. Environment bootstrap — MUST run before `import main`
# ---------------------------------------------------------------------

_ML_SERVICE_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_CSV_PATH = _ML_SERVICE_ROOT.parent / "data" / "projects.csv"

_TEST_TOKEN = "test-internal-api-token"


def _read_supabase_status() -> dict[str, str]:
    """Read local Supabase creds from `supabase status -o json`."""
    try:
        result = subprocess.run(
            ["supabase", "status", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        stdout = result.stdout.strip()
        start = stdout.find("{")
        end = stdout.rfind("}")
        if start != -1 and end != -1:
            payload = json.loads(stdout[start : end + 1])
            return {
                "SUPABASE_URL": payload["API_URL"],
                "SUPABASE_SERVICE_ROLE_KEY": payload["SERVICE_ROLE_KEY"],
            }
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, KeyError):
        pass
    return {
        "SUPABASE_URL": "http://127.0.0.1:54321",
        "SUPABASE_SERVICE_ROLE_KEY": (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            ".eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0"
            ".EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
        ),
    }


_creds = _read_supabase_status()
os.environ["SUPABASE_URL"] = _creds["SUPABASE_URL"]
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = _creds["SUPABASE_SERVICE_ROLE_KEY"]
os.environ["INTERNAL_API_TOKEN"] = _TEST_TOKEN

# Now safe to import — main reads env at module load.
import pandas as pd  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from supabase import create_client  # noqa: E402

import cleaning  # noqa: E402
import main  # noqa: E402
from models import (  # noqa: E402
    MINIMUM_TRAINING_SAMPLES,
    PRE_CONSTRUCTION_RAW_FEATURES,
)


# ---------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------


@pytest.fixture(scope="session")
def sb_admin():
    """Direct service-role client for test setup/teardown."""
    return create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


@pytest.fixture(scope="session", autouse=True)
def _reset_tables_once(sb_admin):
    """Purge test tables once at session start.

    WHY: same rationale as test_ingest.py — avoid `supabase db reset`
    (~45 s) per run; delete-and-reinsert is enough isolation.
    """
    sb_admin.table("model_runs").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    sb_admin.table("projects").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    sb_admin.table("portfolios").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    yield


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_TEST_TOKEN}"}


def _insert_cleaned_rows(sb_admin: Any, portfolio_id: str, df: pd.DataFrame) -> None:
    """Insert a cleaned DataFrame straight into `projects` via service role.

    Uses main._df_to_records so we go through the same JSON-safety path
    /ingest uses — this keeps the Postgres row shape identical.
    """
    records = main._df_to_records(df, portfolio_id=portfolio_id)
    if records:
        sb_admin.table("projects").insert(records).execute()


@pytest.fixture
def seeded_portfolio(sb_admin: Any) -> str:
    """Portfolio seeded with the full 15-row sample (9 Completed).

    Enough completed projects to exceed MINIMUM_TRAINING_SAMPLES=5.
    Teardown removes the portfolio (projects + model_runs cascade).
    """
    pid = str(uuid.uuid4())
    sb_admin.table("portfolios").insert(
        {"id": pid, "name": f"test-train-{pid[:8]}"}
    ).execute()

    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df, _ = cleaning.clean(raw)
    _insert_cleaned_rows(sb_admin, pid, df)

    yield pid

    try:
        sb_admin.table("portfolios").delete().eq("id", pid).execute()
    except Exception:
        pass


@pytest.fixture
def thin_portfolio(sb_admin: Any) -> str:
    """Portfolio with only 2 Completed rows → should trigger 400.

    WHY: the cleaned-and-truncated frame preserves the exact column
    shape `train_*_model` expects, so the 400 we exercise here is the
    genuine "not enough completed projects" branch, not a schema error.
    """
    pid = str(uuid.uuid4())
    sb_admin.table("portfolios").insert(
        {"id": pid, "name": f"test-train-thin-{pid[:8]}"}
    ).execute()

    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df, _ = cleaning.clean(raw)
    completed = df[df["final_status"] == "Completed"].head(2)
    in_progress = df[df["final_status"] == "In Progress"].head(2)
    thin = pd.concat([completed, in_progress], ignore_index=True)
    _insert_cleaned_rows(sb_admin, pid, thin)

    yield pid

    try:
        sb_admin.table("portfolios").delete().eq("id", pid).execute()
    except Exception:
        pass


# ---------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------

# Features that, if present, demonstrate leakage — the naive model must
# have at least one of these (post-construction signals known only after
# the project is complete).
_LEAKY_FEATURES = {
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "actual_duration_days",
}


def test_train_requires_bearer(client: TestClient) -> None:
    """No Authorization header → 401."""
    resp = client.post("/train", json={"portfolio_id": str(uuid.uuid4())})
    assert resp.status_code == 401


def test_train_missing_portfolio(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    bogus_id = str(uuid.uuid4())
    resp = client.post(
        "/train", headers=auth_headers, json={"portfolio_id": bogus_id}
    )
    assert resp.status_code == 404
    detail = resp.json().get("detail", {})
    assert detail["error"] == "portfolio not found"
    assert detail["portfolio_id"] == bogus_id


def test_train_happy_path(
    client: TestClient,
    auth_headers: dict[str, str],
    seeded_portfolio: str,
    sb_admin: Any,
) -> None:
    resp = client.post(
        "/train", headers=auth_headers, json={"portfolio_id": seeded_portfolio}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    for model_key in ("naive", "pre_construction"):
        assert model_key in body
        result = body[model_key]
        # UUID shape check — Postgres-generated id, not something we computed.
        uuid.UUID(result["model_run_id"])
        assert 0.0 <= result["accuracy"] <= 1.0
        assert isinstance(result["features_used"], list)
        assert len(result["features_used"]) > 0
        assert result["n_training_samples"] >= MINIMUM_TRAINING_SAMPLES
        assert isinstance(result["feature_importances"], dict)

    # Exactly 2 rows in model_runs for this portfolio.
    rows = (
        sb_admin.table("model_runs")
        .select("id, model_type")
        .eq("portfolio_id", seeded_portfolio)
        .execute()
    )
    assert len(rows.data) == 2
    assert {r["model_type"] for r in rows.data} == {"naive", "pre_construction"}


def test_train_is_idempotent(
    client: TestClient,
    auth_headers: dict[str, str],
    seeded_portfolio: str,
    sb_admin: Any,
) -> None:
    """Calling /train twice must leave exactly 2 rows — not 4."""
    payload = {"portfolio_id": seeded_portfolio}

    r1 = client.post("/train", headers=auth_headers, json=payload)
    assert r1.status_code == 200
    first_ids = {r1.json()[k]["model_run_id"] for k in ("naive", "pre_construction")}

    r2 = client.post("/train", headers=auth_headers, json=payload)
    assert r2.status_code == 200
    second_ids = {r2.json()[k]["model_run_id"] for k in ("naive", "pre_construction")}

    # Delete-then-insert semantics → new ids, exactly 2 rows total.
    assert first_ids.isdisjoint(second_ids)
    rows = (
        sb_admin.table("model_runs")
        .select("id")
        .eq("portfolio_id", seeded_portfolio)
        .execute()
    )
    assert len(rows.data) == 2


def test_train_insufficient_data(
    client: TestClient,
    auth_headers: dict[str, str],
    thin_portfolio: str,
) -> None:
    resp = client.post(
        "/train", headers=auth_headers, json={"portfolio_id": thin_portfolio}
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json().get("detail", {})
    assert detail["error"] == "insufficient training data"
    assert detail["minimum_required"] == MINIMUM_TRAINING_SAMPLES
    assert detail["n_completed_projects"] < MINIMUM_TRAINING_SAMPLES
    assert detail["n_completed_projects"] >= 0


def test_train_features_used_contract(
    client: TestClient,
    auth_headers: dict[str, str],
    seeded_portfolio: str,
) -> None:
    """Pre-construction features must subset encoded PRE_CONSTRUCTION_RAW;
    naive must contain at least one leaky feature."""
    resp = client.post(
        "/train", headers=auth_headers, json={"portfolio_id": seeded_portfolio}
    )
    assert resp.status_code == 200
    body = resp.json()

    naive_features = set(body["naive"]["features_used"])
    pre_features = set(body["pre_construction"]["features_used"])

    # Naive model must rely on at least one post-construction leak.
    assert naive_features & _LEAKY_FEATURES, (
        f"naive model is missing leaky features; got {naive_features}"
    )

    # Pre-construction features must all derive from the raw allowlist.
    # One-hot encoding produces names like `region_Northeast` — we accept
    # any feature that either is in the raw list or starts with a raw name
    # followed by an underscore (the typical pandas/sklearn get_dummies
    # convention).
    raw = set(PRE_CONSTRUCTION_RAW_FEATURES)
    for feat in pre_features:
        assert feat in raw or any(
            feat.startswith(f"{r}_") for r in raw
        ), f"pre_construction leaked non-allowlisted feature: {feat}"

    # Sanity: pre_construction must NOT include the leaky post-construction
    # signals. This is the whole point of the comparison.
    assert not (pre_features & _LEAKY_FEATURES), (
        f"pre_construction leaked post-construction signals: "
        f"{pre_features & _LEAKY_FEATURES}"
    )
