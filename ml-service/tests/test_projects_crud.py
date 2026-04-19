"""
Tests for POST /projects/upsert and POST /projects/delete (Phase 8c).

Strategy: unlike test_ingest which drives the real local Supabase stack,
these tests patch `main.get_supabase()` to return an in-memory fake. The
endpoints here are thin orchestrators over Supabase calls; a recording
fake is enough to pin the contract (validation, source preservation,
analyze call-through) without a live Postgres.

We also patch `main._analyze_portfolio` so we can assert the
call-through happens exactly once per mutation and isn't flaky on the
risk/driver modules' numeric behavior (their own tests already cover
that).
"""

from __future__ import annotations

import os
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

# WHY: main.py reads env at import time; set enough to let the module
# load cleanly in a test environment where no real Supabase is running.
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_ROLE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0"
    ".EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
)
os.environ.setdefault("INTERNAL_API_TOKEN", "test-internal-api-token")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from main import (  # noqa: E402
    AnalyzeResponse,
    ProjectUpsertInput,
    _compute_actual_duration_days,
    _project_input_to_row,
)


_TEST_TOKEN = os.environ["INTERNAL_API_TOKEN"]


# ---------------------------------------------------------------------
# Fake Supabase client — records calls + serves pre-seeded data
# ---------------------------------------------------------------------


class _FakeQuery:
    """Chainable mock that records method calls and returns stub payloads.

    Mirrors just enough of the supabase-py builder surface that main.py
    exercises: .select / .eq / .limit / .insert / .update / .delete /
    .execute. The recorder on the parent FakeSupabase lets tests pin
    which sequences ran.
    """

    def __init__(self, parent: "_FakeSupabase", table_name: str) -> None:
        self._parent = parent
        self._table = table_name
        self._op: str = "select"
        self._filters: list[tuple[str, str, Any]] = []
        self._payload: Any = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        self._op = "select"
        return self

    def insert(self, data: Any) -> "_FakeQuery":
        self._op = "insert"
        self._payload = data
        return self

    def update(self, data: Any) -> "_FakeQuery":
        self._op = "update"
        self._payload = data
        return self

    def delete(self) -> "_FakeQuery":
        self._op = "delete"
        return self

    def eq(self, col: str, val: Any) -> "_FakeQuery":
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col: str, val: Any) -> "_FakeQuery":
        self._filters.append(("neq", col, val))
        return self

    def limit(self, _n: int) -> "_FakeQuery":
        return self

    def single(self) -> "_FakeQuery":
        return self

    def execute(self) -> MagicMock:
        key = (self._table, self._op)
        self._parent.calls.append(
            {
                "table": self._table,
                "op": self._op,
                "filters": list(self._filters),
                "payload": self._payload,
            }
        )
        # Serve canned responses keyed by (table, op). Default: empty.
        response_data = self._parent.responses.get(key, None)
        if callable(response_data):
            response_data = response_data(self._filters, self._payload)
        resp = MagicMock()
        resp.data = response_data if response_data is not None else []
        return resp


class _FakeSupabase:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        # responses[(table, op)] -> list[dict] OR callable(filters, payload) -> list
        self.responses: dict[tuple[str, str], Any] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


# ---------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_TEST_TOKEN}"}


@pytest.fixture
def fake_sb() -> _FakeSupabase:
    return _FakeSupabase()


@pytest.fixture
def patched_main(fake_sb: _FakeSupabase):
    """Patch get_supabase + _analyze_portfolio; yield a handle for assertions."""
    analyze_mock = MagicMock(
        return_value=AnalyzeResponse(
            portfolio_id="p-1", n_projects=1, n_rules=2
        )
    )
    with (
        patch.object(main, "get_supabase", return_value=fake_sb),
        patch.object(main, "_analyze_portfolio", analyze_mock),
    ):
        yield analyze_mock


# ---------------------------------------------------------------------
# 1. Pydantic validation
# ---------------------------------------------------------------------


def test_upsert_input_negative_contract_value_rejected() -> None:
    with pytest.raises(ValidationError):
        ProjectUpsertInput(
            project_id_external="PRJ-1",
            contract_value_usd=-5,
        )


def test_upsert_input_bad_iso_date_rejected() -> None:
    with pytest.raises(ValidationError):
        ProjectUpsertInput(
            project_id_external="PRJ-1",
            start_date="2025/01/01",  # wrong separator
        )


def test_upsert_input_bad_final_status_rejected() -> None:
    with pytest.raises(ValidationError):
        ProjectUpsertInput(
            project_id_external="PRJ-1",
            final_status="Cancelled",  # not in Literal set
        )


def test_upsert_input_accepts_none_fields() -> None:
    """Partial updates: every optional field can be omitted."""
    parsed = ProjectUpsertInput(project_id_external="PRJ-1")
    assert parsed.project_name is None
    assert parsed.contract_value_usd is None
    assert parsed.anomaly_flags == []


def test_upsert_input_negative_subcontractor_count_rejected() -> None:
    with pytest.raises(ValidationError):
        ProjectUpsertInput(
            project_id_external="PRJ-1",
            subcontractor_count=-2,
        )


# ---------------------------------------------------------------------
# 2. Helper: _compute_actual_duration_days
# ---------------------------------------------------------------------


def test_compute_actual_duration_days_happy() -> None:
    assert _compute_actual_duration_days("2025-01-01", "2025-01-31") == 30


def test_compute_actual_duration_days_missing_returns_none() -> None:
    assert _compute_actual_duration_days(None, "2025-01-31") is None
    assert _compute_actual_duration_days("2025-01-01", None) is None
    assert _compute_actual_duration_days(None, None) is None


def test_compute_actual_duration_days_bad_iso_returns_none() -> None:
    assert _compute_actual_duration_days("not-a-date", "2025-01-31") is None


def test_project_input_to_row_sets_source_and_duration() -> None:
    parsed = ProjectUpsertInput(
        project_id_external="PRJ-1",
        start_date="2025-01-01",
        end_date="2025-02-10",
        contract_value_usd=1_000_000,
    )
    row = _project_input_to_row("pid", parsed, source="manual")
    assert row["source"] == "manual"
    assert row["portfolio_id"] == "pid"
    assert row["project_id_external"] == "PRJ-1"
    assert row["actual_duration_days"] == 40


# ---------------------------------------------------------------------
# 3. Endpoint auth
# ---------------------------------------------------------------------


def test_upsert_requires_bearer(client: TestClient) -> None:
    resp = client.post(
        "/projects/upsert",
        json={
            "portfolio_id": str(uuid.uuid4()),
            "project": {"project_id_external": "PRJ-1"},
        },
    )
    assert resp.status_code == 401


def test_delete_requires_bearer(client: TestClient) -> None:
    resp = client.post(
        "/projects/delete",
        json={
            "portfolio_id": str(uuid.uuid4()),
            "project_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------
# 4. /projects/upsert — INSERT path
# ---------------------------------------------------------------------


def test_upsert_insert_path_writes_source_manual(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    new_row_id = str(uuid.uuid4())

    # Portfolio exists; project lookup by external id returns empty (→ insert);
    # insert returns the generated row with an `id`.
    fake_sb.responses[("portfolios", "select")] = [{"id": pid}]
    fake_sb.responses[("projects", "select")] = []

    def _insert_response(_filters: Any, payload: Any) -> list[dict[str, Any]]:
        stored = dict(payload)
        stored["id"] = new_row_id
        return [stored]

    fake_sb.responses[("projects", "insert")] = _insert_response

    resp = client.post(
        "/projects/upsert",
        headers=auth_headers,
        json={
            "portfolio_id": pid,
            "project": {
                "project_id_external": "PRJ-42",
                "project_name": "New Bridge",
                "project_type": "Infrastructure",
                "contract_value_usd": 50_000_000,
                "start_date": "2025-01-01",
                "end_date": "2025-06-30",
                "region": "Northeast",
                "subcontractor_count": 12,
                "final_status": "In Progress",
            },
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["project"]["id"] == new_row_id
    assert body["project"]["source"] == "manual"
    # actual_duration_days was computed from the two dates (180 days).
    assert body["project"]["actual_duration_days"] == 180
    assert body["analyze"]["n_projects"] == 1

    # Exactly one analyze call per write.
    assert patched_main.call_count == 1

    # An insert call was recorded against `projects`, not an update.
    ops = [(c["table"], c["op"]) for c in fake_sb.calls]
    assert ("projects", "insert") in ops
    assert ("projects", "update") not in ops


def test_upsert_insert_without_dates_skips_duration(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    fake_sb.responses[("portfolios", "select")] = [{"id": pid}]
    fake_sb.responses[("projects", "select")] = []

    def _insert_response(_filters: Any, payload: Any) -> list[dict[str, Any]]:
        stored = dict(payload)
        stored["id"] = str(uuid.uuid4())
        return [stored]

    fake_sb.responses[("projects", "insert")] = _insert_response

    resp = client.post(
        "/projects/upsert",
        headers=auth_headers,
        json={
            "portfolio_id": pid,
            "project": {"project_id_external": "PRJ-99"},
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # No dates → actual_duration_days stays None.
    assert body["project"]["actual_duration_days"] is None


# ---------------------------------------------------------------------
# 5. /projects/upsert — UPDATE BY ID path (preserves source)
# ---------------------------------------------------------------------


def test_upsert_update_by_id_preserves_csv_source(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    existing_id = str(uuid.uuid4())

    fake_sb.responses[("portfolios", "select")] = [{"id": pid}]
    # Lookup-by-id finds a row that was originally CSV-sourced.
    fake_sb.responses[("projects", "select")] = [
        {"id": existing_id, "source": "csv", "portfolio_id": pid}
    ]

    def _update_response(_filters: Any, payload: Any) -> list[dict[str, Any]]:
        stored = dict(payload)
        stored["id"] = existing_id
        return [stored]

    fake_sb.responses[("projects", "update")] = _update_response

    resp = client.post(
        "/projects/upsert",
        headers=auth_headers,
        json={
            "portfolio_id": pid,
            "project": {
                "id": existing_id,
                "project_id_external": "PRJ-CSV-42",
                "project_name": "Edited via UI",
            },
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The row that was stored kept source='csv' even though the edit
    # came from the UI. Provenance is preserved.
    assert body["project"]["source"] == "csv"
    assert patched_main.call_count == 1

    ops = [(c["table"], c["op"]) for c in fake_sb.calls]
    assert ("projects", "update") in ops
    assert ("projects", "insert") not in ops


def test_upsert_update_by_id_rejects_cross_portfolio(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    other_pid = str(uuid.uuid4())
    existing_id = str(uuid.uuid4())

    fake_sb.responses[("portfolios", "select")] = [{"id": pid}]
    # The project exists but belongs to a DIFFERENT portfolio.
    fake_sb.responses[("projects", "select")] = [
        {"id": existing_id, "source": "csv", "portfolio_id": other_pid}
    ]

    resp = client.post(
        "/projects/upsert",
        headers=auth_headers,
        json={
            "portfolio_id": pid,
            "project": {"id": existing_id, "project_id_external": "PRJ-1"},
        },
    )
    assert resp.status_code == 400
    # No analyze call on a 400.
    assert patched_main.call_count == 0


# ---------------------------------------------------------------------
# 6. /projects/upsert — UPDATE BY EXTERNAL ID path
# ---------------------------------------------------------------------


def test_upsert_update_by_external_id(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    existing_id = str(uuid.uuid4())

    fake_sb.responses[("portfolios", "select")] = [{"id": pid}]
    # No `id` in request → lookup by (portfolio_id, external_id) hits.
    fake_sb.responses[("projects", "select")] = [
        {"id": existing_id, "source": "manual"}
    ]

    def _update_response(_filters: Any, payload: Any) -> list[dict[str, Any]]:
        stored = dict(payload)
        stored["id"] = existing_id
        return [stored]

    fake_sb.responses[("projects", "update")] = _update_response

    resp = client.post(
        "/projects/upsert",
        headers=auth_headers,
        json={
            "portfolio_id": pid,
            "project": {
                "project_id_external": "PRJ-MAN-1",
                "cost_overrun_pct": 12.5,
            },
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["project"]["source"] == "manual"
    assert body["project"]["id"] == existing_id
    assert patched_main.call_count == 1

    # Verify the lookup used BOTH portfolio_id and project_id_external filters.
    select_calls = [c for c in fake_sb.calls if c["table"] == "projects" and c["op"] == "select"]
    assert select_calls, "expected a SELECT on projects"
    cols_used = {f[1] for f in select_calls[0]["filters"]}
    assert "portfolio_id" in cols_used
    assert "project_id_external" in cols_used


# ---------------------------------------------------------------------
# 7. /projects/upsert — 404 on unknown portfolio
# ---------------------------------------------------------------------


def test_upsert_unknown_portfolio_404(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    fake_sb.responses[("portfolios", "select")] = []  # not found
    resp = client.post(
        "/projects/upsert",
        headers=auth_headers,
        json={
            "portfolio_id": str(uuid.uuid4()),
            "project": {"project_id_external": "PRJ-1"},
        },
    )
    assert resp.status_code == 404
    body = resp.json()
    detail = body.get("detail", body)
    assert detail["error"] == "portfolio not found"
    assert patched_main.call_count == 0


# ---------------------------------------------------------------------
# 8. /projects/delete — happy path + cascade reliance
# ---------------------------------------------------------------------


def test_delete_happy_path_and_analyze_callthrough(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    project_id = str(uuid.uuid4())

    # Project lookup returns the project belonging to the right portfolio.
    fake_sb.responses[("projects", "select")] = [
        {"id": project_id, "portfolio_id": pid}
    ]
    # Delete returns the deleted row (supabase-py behavior varies but we
    # don't depend on the return shape).
    fake_sb.responses[("projects", "delete")] = [{"id": project_id}]

    resp = client.post(
        "/projects/delete",
        headers=auth_headers,
        json={"portfolio_id": pid, "project_id": project_id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["deleted_id"] == project_id
    assert "analyze" in body
    assert patched_main.call_count == 1

    # WHY: cascade verification — we only DELETE from `projects`. The
    # risk_scores / project_segments rows are expected to vanish via the
    # FK cascade declared in the migration. This test pins that we do
    # NOT issue extra deletes against those tables (if we ever do, the
    # cascade has silently become redundant or broken).
    deletes = [c for c in fake_sb.calls if c["op"] == "delete"]
    assert any(c["table"] == "projects" for c in deletes)
    # analyze() does its own deletes on the derived tables; those live
    # inside the mocked _analyze_portfolio and so don't show up here.
    for call in deletes:
        assert call["table"] == "projects", (
            f"unexpected direct delete against {call['table']!r}; "
            "risk_scores/project_segments should cascade from projects"
        )


def test_delete_unknown_project_404(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    fake_sb.responses[("projects", "select")] = []
    resp = client.post(
        "/projects/delete",
        headers=auth_headers,
        json={
            "portfolio_id": str(uuid.uuid4()),
            "project_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 404
    assert patched_main.call_count == 0


def test_delete_cross_portfolio_400(
    client: TestClient,
    auth_headers: dict[str, str],
    fake_sb: _FakeSupabase,
    patched_main: MagicMock,
) -> None:
    pid = str(uuid.uuid4())
    other_pid = str(uuid.uuid4())
    project_id = str(uuid.uuid4())

    fake_sb.responses[("projects", "select")] = [
        {"id": project_id, "portfolio_id": other_pid}
    ]
    resp = client.post(
        "/projects/delete",
        headers=auth_headers,
        json={"portfolio_id": pid, "project_id": project_id},
    )
    assert resp.status_code == 400
    assert patched_main.call_count == 0
