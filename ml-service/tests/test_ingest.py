"""
Tests for POST /ingest — Phase 2 · Task B.

These tests drive the real Python process against a locally running
Supabase stack (`supabase start`). They set up env BEFORE importing
`main`, because main.py snapshots SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
into a module-level client at import time.

Prerequisites (the controller's spec confirms these are in place):
- `supabase start` running on 127.0.0.1:54321
- Migrations applied (so the `portfolios-uploads` bucket exists)

Each test is wrapped in a session-scoped fixture that:
1. Points the ML service at the local stack via env vars.
2. Resets the `portfolios` / `projects` tables.
3. Uploads the canonical CSV fixture to a known storage path.

WHY: we reset rather than `supabase db reset --local` in the fixture —
the latter takes ~45 s per run and would make TDD miserable. Instead
we delete-and-reinsert the two tables we care about, which is enough
isolation for these tests and keeps the fixture fast.
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

_BUCKET = "portfolios-uploads"
_TEST_TOKEN = "test-internal-api-token"


def _read_supabase_status() -> dict[str, str]:
    """Read local Supabase creds from `supabase status -o json`.

    Falls back to the well-known local defaults if the CLI isn't on PATH
    so tests can still run in a minimal environment — but the 2026-04
    local stack print is the source of truth.
    """
    try:
        result = subprocess.run(
            ["supabase", "status", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        # stdout may contain a leading CLI notice; take the last JSON object.
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
    # Well-known local defaults — the supabase CLI has used these since 1.x.
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
from fastapi.testclient import TestClient  # noqa: E402
from supabase import create_client  # noqa: E402

import main  # noqa: E402


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
    """Delete any pre-existing test fixtures before the run starts.

    WHY autouse + session: we want one cleanup at the start so reruns
    from a dirty DB don't surprise us, but we don't want to reset
    between every test (slow, and some tests are meant to observe
    state built by earlier fixture steps).
    """
    # eq('portfolio_id', '00000000-...') alone won't match anything;
    # we purge everything in `projects` because this table only exists
    # for test data during this test run against the local stack.
    # Using a filter that's always true (id is not null) gets around
    # PostgREST's safeguard against unfiltered deletes.
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


@pytest.fixture
def portfolio_id(sb_admin) -> str:
    """Create a fresh portfolio row and upload the canonical CSV fixture.

    Yields the portfolio UUID; teardown removes it (cascade drops any
    project rows the test inserted).
    """
    pid = str(uuid.uuid4())
    sb_admin.table("portfolios").insert(
        {"id": pid, "name": f"test-portfolio-{pid[:8]}"}
    ).execute()

    # Upload the 15-row sample to the known path.
    storage_path = f"portfolios/{pid}/raw.csv"
    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    try:
        sb_admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=raw,
            file_options={"content-type": "text/csv", "upsert": "true"},
        )
    except Exception as exc:
        # WHY: the bucket may already hold the object from a prior run —
        # re-attempt once after an explicit remove. Any other failure is a
        # real setup problem and should surface.
        sb_admin.storage.from_(_BUCKET).remove([storage_path])
        try:
            sb_admin.storage.from_(_BUCKET).upload(
                path=storage_path,
                file=raw,
                file_options={"content-type": "text/csv"},
            )
        except Exception as retry_exc:
            raise RuntimeError(
                f"Storage upload failed twice (path={storage_path}): "
                f"first={exc!r}; retry={retry_exc!r}"
            ) from retry_exc

    yield pid

    # Teardown — best-effort; don't fail the test on cleanup errors.
    try:
        sb_admin.storage.from_(_BUCKET).remove([storage_path])
    except Exception:
        pass
    try:
        sb_admin.table("portfolios").delete().eq("id", pid).execute()
    except Exception:
        pass


# ---------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------


def test_ingest_requires_bearer(client: TestClient) -> None:
    """No Authorization header → 401."""
    resp = client.post(
        "/ingest",
        json={
            "portfolio_id": str(uuid.uuid4()),
            "storage_path": "portfolios/whatever/raw.csv",
        },
    )
    assert resp.status_code == 401


def test_ingest_happy_path(
    client: TestClient,
    auth_headers: dict[str, str],
    portfolio_id: str,
    sb_admin: Any,
) -> None:
    storage_path = f"portfolios/{portfolio_id}/raw.csv"
    resp = client.post(
        "/ingest",
        headers=auth_headers,
        json={"portfolio_id": portfolio_id, "storage_path": storage_path},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["portfolio_id"] == portfolio_id
    assert body["row_count"] == 15
    # Exact count — the 15-row `data/projects.csv` fixture has 3 rows with
    # non-empty anomaly_flags after cleaning (rows 2, 6, 8). Pinning the
    # number catches regressions in anomaly detection thresholds.
    assert body["anomaly_count"] == 3
    assert "cleaning_report" in body
    assert isinstance(body["cleaning_report"]["imputations"], list)

    # Verify `projects` rows were inserted.
    projects = (
        sb_admin.table("projects")
        .select("id, portfolio_id, project_id_external, anomaly_flags")
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    assert len(projects.data) == 15

    # Verify portfolio metadata was updated.
    portfolio = (
        sb_admin.table("portfolios")
        .select("row_count, anomaly_count, cleaning_report")
        .eq("id", portfolio_id)
        .single()
        .execute()
    )
    assert portfolio.data["row_count"] == 15
    assert portfolio.data["anomaly_count"] == 3
    # cleaning_report should have the three TypedDict keys populated.
    cr = portfolio.data["cleaning_report"]
    assert set(cr.keys()) == {"imputations", "type_coercions", "rows_rejected"}


def test_ingest_is_idempotent(
    client: TestClient,
    auth_headers: dict[str, str],
    portfolio_id: str,
    sb_admin: Any,
) -> None:
    storage_path = f"portfolios/{portfolio_id}/raw.csv"
    payload = {"portfolio_id": portfolio_id, "storage_path": storage_path}

    r1 = client.post("/ingest", headers=auth_headers, json=payload)
    assert r1.status_code == 200
    r2 = client.post("/ingest", headers=auth_headers, json=payload)
    assert r2.status_code == 200

    projects = (
        sb_admin.table("projects")
        .select("id", count="exact")
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    # Delete-then-insert semantics mean row count is 15, not 30.
    assert len(projects.data) == 15


def test_ingest_missing_portfolio(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    bogus_id = str(uuid.uuid4())
    resp = client.post(
        "/ingest",
        headers=auth_headers,
        json={"portfolio_id": bogus_id, "storage_path": f"portfolios/{bogus_id}/raw.csv"},
    )
    assert resp.status_code == 404
    body = resp.json()
    # FastAPI wraps `detail=<dict>` inside a top-level "detail" key.
    detail = body.get("detail", body)
    assert detail["error"] == "portfolio not found"
    assert detail["portfolio_id"] == bogus_id


def test_ingest_missing_storage_path(
    client: TestClient,
    auth_headers: dict[str, str],
    sb_admin: Any,
) -> None:
    """Canonical path shape, but the object isn't uploaded → 404.

    WHY: uses a fresh portfolio_id whose raw.csv is NOT uploaded to storage,
    so the path passes the canonical check and the 404 is the genuine
    storage-miss branch (not the path-validation branch).
    """
    pid = str(uuid.uuid4())
    sb_admin.table("portfolios").insert(
        {"id": pid, "name": f"test-missing-{pid[:8]}"}
    ).execute()
    canonical_path = f"portfolios/{pid}/raw.csv"
    try:
        resp = client.post(
            "/ingest",
            headers=auth_headers,
            json={"portfolio_id": pid, "storage_path": canonical_path},
        )
        assert resp.status_code == 404
        body = resp.json()
        detail = body.get("detail", body)
        assert detail["error"] == "csv not found at storage_path"
        assert detail["storage_path"] == canonical_path
    finally:
        sb_admin.table("portfolios").delete().eq("id", pid).execute()


def test_ingest_malformed_csv(
    client: TestClient,
    auth_headers: dict[str, str],
    sb_admin: Any,
) -> None:
    """Upload a CSV missing a required column → 400."""
    pid = str(uuid.uuid4())
    sb_admin.table("portfolios").insert(
        {"id": pid, "name": f"test-malformed-{pid[:8]}"}
    ).execute()

    # WHY: the filename must be `raw.csv` to pass the canonical-path check;
    # the malformed-CSV behavior we're testing is orthogonal to the path.
    storage_path = f"portfolios/{pid}/raw.csv"
    # Missing `region` (and most other required columns) — parse_csv must reject.
    bad_csv = b"project_id,project_name\nPRJ001,Test\n"
    try:
        sb_admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=bad_csv,
            file_options={"content-type": "text/csv"},
        )

        resp = client.post(
            "/ingest",
            headers=auth_headers,
            json={"portfolio_id": pid, "storage_path": storage_path},
        )
        assert resp.status_code == 400
        body = resp.json()
        detail = body.get("detail", body)
        assert detail["error"] == "malformed CSV"
        assert "details" in detail
    finally:
        try:
            sb_admin.storage.from_(_BUCKET).remove([storage_path])
        except Exception:
            pass
        sb_admin.table("portfolios").delete().eq("id", pid).execute()


def test_ingest_rejects_traversal_path(
    client: TestClient,
    auth_headers: dict[str, str],
    portfolio_id: str,
) -> None:
    """Path-traversal payload → 400 before hitting the storage SDK."""
    r = client.post(
        "/ingest",
        json={
            "portfolio_id": portfolio_id,
            "storage_path": "portfolios/../evil.csv",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400
    body = r.json()
    detail = body.get("detail", body)
    assert detail["error"] == "invalid storage_path"


def test_ingest_rejects_cross_portfolio_path(
    client: TestClient,
    auth_headers: dict[str, str],
    portfolio_id: str,
) -> None:
    """A path for a DIFFERENT portfolio_id must 400 — prevents cross-ingest."""
    other_uuid = str(uuid.uuid4())
    r = client.post(
        "/ingest",
        json={
            "portfolio_id": portfolio_id,
            "storage_path": f"portfolios/{other_uuid}/raw.csv",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400
    detail = r.json().get("detail", {})
    assert "canonical shape" in detail.get("error", "")


def test_ingest_rejects_wrong_filename(
    client: TestClient,
    auth_headers: dict[str, str],
    portfolio_id: str,
) -> None:
    """Path within the right portfolio but wrong filename → 400."""
    r = client.post(
        "/ingest",
        json={
            "portfolio_id": portfolio_id,
            "storage_path": f"portfolios/{portfolio_id}/other.csv",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400
    detail = r.json().get("detail", {})
    assert "canonical shape" in detail.get("error", "")


def test_ingest_binary_file_is_400(
    client: TestClient,
    auth_headers: dict[str, str],
    sb_admin: Any,
) -> None:
    """A non-UTF-8 binary payload must yield 400 (not 500) via the
    broadened pandas/UnicodeDecodeError handlers."""
    pid = str(uuid.uuid4())
    sb_admin.table("portfolios").insert(
        {"id": pid, "name": f"test-bin-{pid[:8]}"}
    ).execute()
    storage_path = f"portfolios/{pid}/raw.csv"
    # Invalid UTF-8 bytes.
    bad_bytes = b"\xff\xfe\x00\x00\x89PNG\r\n\x1a\n"
    try:
        sb_admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=bad_bytes,
            file_options={"content-type": "text/csv"},
        )
        resp = client.post(
            "/ingest",
            headers=auth_headers,
            json={"portfolio_id": pid, "storage_path": storage_path},
        )
        assert resp.status_code == 400, resp.text
        detail = resp.json().get("detail", {})
        assert detail["error"] == "malformed CSV"
    finally:
        try:
            sb_admin.storage.from_(_BUCKET).remove([storage_path])
        except Exception:
            pass
        sb_admin.table("portfolios").delete().eq("id", pid).execute()


def test_df_to_records_nullable_int_becomes_none() -> None:
    """pd.NA in a nullable-Int64 column must serialize as Python None.

    WHY: the previous `df.astype(object).where(df.notna(), None)` variant
    computed the mask on the pre-cast frame; for nullable Int64 the cast
    leaves `pd.NA` as `pd.NA`, so a stale mask could let the sentinel
    survive into JSON. Regression guard.
    """
    import pandas as pd

    df = pd.DataFrame(
        {
            "project_id_external": ["A", "B"],
            "safety_incidents": pd.array([1, pd.NA], dtype="Int64"),
            "anomaly_flags": [[], []],
        }
    )
    records = main._df_to_records(df, portfolio_id="00000000-0000-0000-0000-000000000000")
    assert len(records) == 2
    assert records[0]["safety_incidents"] == 1
    assert records[1]["safety_incidents"] is None
    # Defensive: explicitly not the sentinel or a string.
    assert records[1]["safety_incidents"] is not pd.NA
    assert records[1]["safety_incidents"] != "NA"


def test_ingest_accepts_bucket_prefixed_path(
    client: TestClient,
    auth_headers: dict[str, str],
    portfolio_id: str,
) -> None:
    """`portfolios-uploads/portfolios/<uuid>/raw.csv` should also work.

    The spec calls for accepting either shape so callers don't 404 on a
    cosmetic prefix difference.
    """
    prefixed = f"{_BUCKET}/portfolios/{portfolio_id}/raw.csv"
    resp = client.post(
        "/ingest",
        headers=auth_headers,
        json={"portfolio_id": portfolio_id, "storage_path": prefixed},
    )
    assert resp.status_code == 200
    assert resp.json()["row_count"] == 15
