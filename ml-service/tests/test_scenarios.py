"""
Tests for scenarios.py — encoding, KNN cohort, cohort stats, /simulate shape.

Run from the `ml-service/` directory:

    pytest tests/test_scenarios.py
"""

from __future__ import annotations

import pandas as pd
import pytest

from scenarios import (
    cohort_range,
    cohort_rate,
    encode_projects_matrix,
    encode_query_vector,
    nearest_cohort,
    simulate,
)


# ---------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------


def _ten_row_fixture() -> pd.DataFrame:
    """10-row portfolio with varied project_type / region / size.

    Deliberately includes:
      - 4 Infrastructure / Northeast rows (so a query matching those
        gets a meaningful cohort).
      - 3 Commercial / Southeast rows.
      - 3 Industrial / Midwest rows.
    And a mix of disputes/no-disputes so the rate path is non-trivial.
    """
    rows = [
        {"id": "a1", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 80_000_000, "subcontractor_count": 20,
         "delay_days": 200, "cost_overrun_pct": 30.0, "safety_incidents": 2,
         "payment_disputes": 3, "final_status": "Completed"},
        {"id": "a2", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 90_000_000, "subcontractor_count": 25,
         "delay_days": 160, "cost_overrun_pct": 28.0, "safety_incidents": 3,
         "payment_disputes": 2, "final_status": "Completed"},
        {"id": "a3", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 70_000_000, "subcontractor_count": 18,
         "delay_days": 180, "cost_overrun_pct": 27.0, "safety_incidents": 1,
         "payment_disputes": 1, "final_status": "Completed"},
        {"id": "a4", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 60_000_000, "subcontractor_count": 15,
         "delay_days": 140, "cost_overrun_pct": 22.0, "safety_incidents": 2,
         "payment_disputes": 1, "final_status": "Completed"},
        {"id": "b1", "project_type": "Commercial", "region": "Southeast",
         "contract_value_usd": 25_000_000, "subcontractor_count": 5,
         "delay_days": 5, "cost_overrun_pct": 1.0, "safety_incidents": 0,
         "payment_disputes": 0, "final_status": "Completed"},
        {"id": "b2", "project_type": "Commercial", "region": "Southeast",
         "contract_value_usd": 30_000_000, "subcontractor_count": 6,
         "delay_days": 10, "cost_overrun_pct": 2.0, "safety_incidents": 0,
         "payment_disputes": 0, "final_status": "Completed"},
        {"id": "b3", "project_type": "Commercial", "region": "Southeast",
         "contract_value_usd": 35_000_000, "subcontractor_count": 7,
         "delay_days": 8, "cost_overrun_pct": 1.5, "safety_incidents": 0,
         "payment_disputes": 0, "final_status": "Completed"},
        {"id": "c1", "project_type": "Industrial", "region": "Midwest",
         "contract_value_usd": 18_000_000, "subcontractor_count": 4,
         "delay_days": 20, "cost_overrun_pct": 5.0, "safety_incidents": 1,
         "payment_disputes": 0, "final_status": "Completed"},
        {"id": "c2", "project_type": "Industrial", "region": "Midwest",
         "contract_value_usd": 22_000_000, "subcontractor_count": 6,
         "delay_days": 30, "cost_overrun_pct": 7.0, "safety_incidents": 2,
         "payment_disputes": 1, "final_status": "Completed"},
        {"id": "c3", "project_type": "Industrial", "region": "Midwest",
         "contract_value_usd": 20_000_000, "subcontractor_count": 5,
         "delay_days": 25, "cost_overrun_pct": 6.0, "safety_incidents": 1,
         "payment_disputes": 1, "final_status": "Completed"},
    ]
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------


def test_encode_projects_matrix_shape() -> None:
    df = _ten_row_fixture()
    matrix, feature_names = encode_projects_matrix(df)
    assert matrix.shape == (len(df), len(feature_names))
    # Expect the two numeric columns plus at least one dummy per categorical.
    assert "log_contract_value" in feature_names
    assert "subcontractor_count" in feature_names
    assert any(name.startswith("project_type=") for name in feature_names)
    assert any(name.startswith("region=") for name in feature_names)


def test_encode_query_vector_shape_and_onehot() -> None:
    df = _ten_row_fixture()
    _, feature_names = encode_projects_matrix(df)
    vec = encode_query_vector(
        project_type="Infrastructure",
        region="Northeast",
        contract_value_usd=75_000_000,
        subcontractor_count=18,
        feature_names=feature_names,
        fallback_contract_value=40_000_000.0,
    )
    assert vec.shape == (1, len(feature_names))
    # The matching one-hot columns must be exactly 1.0; non-matching 0.0.
    idx_type = feature_names.index("project_type=Infrastructure")
    idx_region = feature_names.index("region=Northeast")
    assert vec[0, idx_type] == 1.0
    assert vec[0, idx_region] == 1.0
    # Non-matching one-hot (Commercial) should be 0.0.
    idx_comm = feature_names.index("project_type=Commercial")
    assert vec[0, idx_comm] == 0.0


# ---------------------------------------------------------------------
# nearest_cohort
# ---------------------------------------------------------------------


def test_nearest_cohort_k_larger_than_n_returns_all() -> None:
    df = _ten_row_fixture()
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 75_000_000,
        "subcontractor_count": 18,
    }
    cohort = nearest_cohort(df, query, k=50)
    assert len(cohort) == len(df)


def test_nearest_cohort_k_three_returns_exactly_three() -> None:
    df = _ten_row_fixture()
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 75_000_000,
        "subcontractor_count": 18,
    }
    cohort = nearest_cohort(df, query, k=3)
    assert len(cohort) == 3
    # All three nearest should be the Infrastructure/Northeast rows.
    ids = set(cohort["id"].tolist())
    assert ids.issubset({"a1", "a2", "a3", "a4"})


def test_nearest_cohort_empty_df_returns_empty() -> None:
    empty = pd.DataFrame(
        columns=[
            "id", "project_type", "region",
            "contract_value_usd", "subcontractor_count",
        ]
    )
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 10_000_000,
        "subcontractor_count": 5,
    }
    cohort = nearest_cohort(empty, query, k=5)
    assert cohort.empty


# ---------------------------------------------------------------------
# cohort_range
# ---------------------------------------------------------------------


def test_cohort_range_empty_cohort() -> None:
    empty = pd.DataFrame(columns=["delay_days"])
    result = cohort_range(empty, "delay_days")
    assert result == {
        "p25": None, "p50": None, "p75": None,
        "n": 0, "confidence": "low",
    }


def test_cohort_range_high_confidence_monotone() -> None:
    df = _ten_row_fixture()
    result = cohort_range(df, "delay_days")
    assert result["n"] == 10
    assert result["confidence"] == "high"
    assert result["p25"] <= result["p50"] <= result["p75"]


def test_cohort_range_medium_confidence_on_four_rows() -> None:
    df = _ten_row_fixture().head(4)
    result = cohort_range(df, "delay_days")
    assert result["n"] == 4
    assert result["confidence"] == "medium"


def test_cohort_range_missing_column_returns_empty() -> None:
    df = _ten_row_fixture()
    result = cohort_range(df, "does_not_exist")
    assert result["n"] == 0
    assert result["p25"] is None


# ---------------------------------------------------------------------
# cohort_rate
# ---------------------------------------------------------------------


def test_cohort_rate_all_true_predicate() -> None:
    df = _ten_row_fixture()
    # Predicate: "is final_status == Completed" — always True on our fixture.
    result = cohort_rate(df, lambda row: row["final_status"] == "Completed")
    assert result["rate"] == 1.0
    assert result["n"] == 10
    # Wilson at k=n caps ci_high at 1.0.
    assert pytest.approx(result["ci_high"], abs=1e-9) == 1.0
    assert result["confidence"] == "high"


def test_cohort_rate_empty_cohort() -> None:
    empty = pd.DataFrame(columns=["payment_disputes"])
    result = cohort_rate(empty, lambda row: row["payment_disputes"] >= 1)
    assert result["rate"] is None
    assert result["n"] == 0
    assert result["confidence"] == "low"


def test_cohort_rate_none_predicate_excluded() -> None:
    df = _ten_row_fixture().head(3).copy()
    # Predicate returns None for one row — it should drop from both
    # numerator and denominator.
    def pred(row: pd.Series) -> bool | None:
        if row["id"] == "a1":
            return None
        return row["payment_disputes"] >= 1

    result = cohort_rate(df, pred)
    assert result["n"] == 2  # a1 excluded, a2 + a3 counted
    assert result["rate"] == 1.0  # a2 and a3 both have disputes


# ---------------------------------------------------------------------
# simulate — end to end
# ---------------------------------------------------------------------


def test_simulate_happy_path_infrastructure_query() -> None:
    df = _ten_row_fixture()
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 75_000_000,
        "subcontractor_count": 18,
    }
    result = simulate(df, query, k=5)
    assert result["cohort_size"] > 0
    assert result["k_requested"] == 5
    assert len(result["similar_project_ids"]) == result["cohort_size"]
    # All four outcome blocks present and populated with n.
    outcomes = result["outcomes"]
    assert set(outcomes.keys()) == {
        "delay_days", "cost_overrun_pct", "safety_incidents", "any_dispute",
    }
    assert outcomes["delay_days"]["n"] > 0
    assert outcomes["delay_days"]["p50"] is not None


def test_simulate_k_larger_than_n_returns_full_cohort() -> None:
    df = _ten_row_fixture()
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 75_000_000,
        "subcontractor_count": 18,
    }
    result = simulate(df, query, k=20)
    assert result["cohort_size"] == 10
    assert result["k_requested"] == 20


def test_simulate_small_cohort_emits_caveat() -> None:
    # Use a 3-row slice so cohort_size < 5 triggers the "directional" caveat.
    df = _ten_row_fixture().head(3)
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 75_000_000,
        "subcontractor_count": 18,
    }
    result = simulate(df, query, k=3)
    assert result["cohort_size"] == 3
    assert any("n<5" in c for c in result["caveats"])


def test_simulate_empty_portfolio_returns_empty_cohort() -> None:
    empty = pd.DataFrame(
        columns=[
            "id", "project_type", "region",
            "contract_value_usd", "subcontractor_count",
            "delay_days", "cost_overrun_pct", "safety_incidents",
            "payment_disputes", "final_status",
        ]
    )
    query = {
        "project_type": "Infrastructure",
        "region": "Northeast",
        "contract_value_usd": 50_000_000,
        "subcontractor_count": 10,
    }
    result = simulate(empty, query, k=5)
    assert result["cohort_size"] == 0
    assert result["similar_project_ids"] == []
    assert result["outcomes"]["delay_days"]["n"] == 0
    assert result["outcomes"]["any_dispute"]["rate"] is None
    assert any("No similar projects" in c for c in result["caveats"])
