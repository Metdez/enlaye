"""
Tests for risk.py — composite risk score + breakdown.

Run from the `ml-service/` directory:

    pytest tests/test_risk.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from cleaning import clean
from risk import compute_scores


_ML_SERVICE_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_CSV_PATH = _ML_SERVICE_ROOT.parent / "data" / "projects.csv"


def _cleaned_sample_with_ids() -> pd.DataFrame:
    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df, _ = clean(raw)
    df = df.copy()
    df["id"] = [f"uuid-{i}" for i in range(len(df))]
    return df


# ---------------------------------------------------------------------
# Score bounds + breakdown shape
# ---------------------------------------------------------------------


def test_scores_are_in_valid_range() -> None:
    cleaned = _cleaned_sample_with_ids()
    scores = compute_scores(cleaned)
    assert len(scores) == len(cleaned)
    for row in scores:
        assert 0 <= row["score"] <= 100
        assert isinstance(row["score"], int)


def test_breakdown_shape() -> None:
    cleaned = _cleaned_sample_with_ids()
    scores = compute_scores(cleaned)
    for row in scores:
        bd = row["breakdown"]
        assert set(bd.keys()) == {"subscores", "weights", "top_driver", "flags"}
        assert set(bd["subscores"].keys()) == {
            "type_risk",
            "region_risk",
            "size_risk",
            "complexity_risk",
            "duration_risk",
        }
        assert set(bd["weights"].keys()) == set(bd["subscores"].keys())
        # Every subscore must be in [0, 1].
        for v in bd["subscores"].values():
            assert 0.0 <= v <= 1.0
        # Top driver must name an actual subscore.
        assert bd["top_driver"] in bd["subscores"]
        assert isinstance(bd["flags"], list)


def test_weights_sum_to_one() -> None:
    cleaned = _cleaned_sample_with_ids()
    scores = compute_scores(cleaned)
    # Any row's weights dict will do; they're all the same.
    weights = scores[0]["breakdown"]["weights"]
    assert pytest.approx(sum(weights.values()), rel=1e-6) == 1.0


# ---------------------------------------------------------------------
# In-progress projects → unknown_duration flag
# ---------------------------------------------------------------------


def test_in_progress_project_has_unknown_duration_flag() -> None:
    cleaned = _cleaned_sample_with_ids()
    scores = compute_scores(cleaned)
    # Zip scores back to the frame via project_id.
    by_pid = {row["project_id"]: row for row in scores}

    in_progress_ids = cleaned[cleaned["final_status"] != "Completed"]["id"].tolist()
    assert len(in_progress_ids) > 0, "fixture must have at least one in-progress row"

    for pid in in_progress_ids:
        row = by_pid[pid]
        assert "unknown_duration" in row["breakdown"]["flags"]
        assert row["breakdown"]["subscores"]["duration_risk"] == 0.5


# ---------------------------------------------------------------------
# Sparse cohort handling
# ---------------------------------------------------------------------


def test_sparse_type_flag_when_type_has_no_completed_peers() -> None:
    # Build a 4-row synthetic portfolio where one project_type has
    # zero completed peers — that project should get sparse_type + 0.5.
    rows = [
        {
            "id": "p1",
            "project_type": "Commercial",
            "region": "Northeast",
            "contract_value_usd": 10_000_000.0,
            "subcontractor_count": 5,
            "delay_days": 10,
            "cost_overrun_pct": 2.0,
            "safety_incidents": 0,
            "payment_disputes": 0,
            "final_status": "Completed",
            "actual_duration_days": 365,
        },
        {
            "id": "p2",
            "project_type": "Commercial",
            "region": "Northeast",
            "contract_value_usd": 20_000_000.0,
            "subcontractor_count": 8,
            "delay_days": 20,
            "cost_overrun_pct": 3.0,
            "safety_incidents": 0,
            "payment_disputes": 0,
            "final_status": "Completed",
            "actual_duration_days": 400,
        },
        {
            "id": "p3",
            "project_type": "Commercial",
            "region": "Southeast",
            "contract_value_usd": 30_000_000.0,
            "subcontractor_count": 10,
            "delay_days": 15,
            "cost_overrun_pct": 5.0,
            "safety_incidents": 1,
            "payment_disputes": 1,
            "final_status": "Completed",
            "actual_duration_days": 450,
        },
        # A rare-type in-progress project. Its project_type ('Energy')
        # has no completed peers in this synthetic frame, so type_risk
        # must default to 0.5 with sparse_type.
        {
            "id": "p4",
            "project_type": "Energy",
            "region": "Mountain",
            "contract_value_usd": 40_000_000.0,
            "subcontractor_count": 6,
            "delay_days": None,
            "cost_overrun_pct": None,
            "safety_incidents": None,
            "payment_disputes": None,
            "final_status": "In Progress",
            "actual_duration_days": None,
        },
    ]
    df = pd.DataFrame(rows)

    scores = compute_scores(df)
    by_pid = {row["project_id"]: row for row in scores}

    rare = by_pid["p4"]["breakdown"]
    assert "sparse_type" in rare["flags"]
    assert rare["subscores"]["type_risk"] == 0.5
    # Region 'Mountain' also has no completed peers → sparse_region.
    assert "sparse_region" in rare["flags"]
    assert rare["subscores"]["region_risk"] == 0.5


# ---------------------------------------------------------------------
# Empty portfolio
# ---------------------------------------------------------------------


def test_empty_df_returns_empty_list() -> None:
    empty = pd.DataFrame(
        columns=[
            "id",
            "project_type",
            "region",
            "contract_value_usd",
            "subcontractor_count",
            "delay_days",
            "cost_overrun_pct",
            "safety_incidents",
            "payment_disputes",
            "final_status",
            "actual_duration_days",
        ]
    )
    assert compute_scores(empty) == []
