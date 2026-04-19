"""
Tests for drivers.py — Wilson CI, confidence labels, rule computation.

Run from the `ml-service/` directory:

    pytest tests/test_drivers.py
"""

from __future__ import annotations

import pandas as pd
import pytest

from drivers import compute_rules, confidence_label, wilson_interval


# ---------------------------------------------------------------------
# wilson_interval
# ---------------------------------------------------------------------


def test_wilson_n_zero_returns_zero_interval() -> None:
    assert wilson_interval(0, 0) == (0.0, 0.0)


def test_wilson_basic_interval_ordered_and_in_range() -> None:
    low, high = wilson_interval(5, 10)
    assert 0.0 <= low < high <= 1.0
    # The point estimate (0.5) should lie within the CI.
    assert low <= 0.5 <= high


def test_wilson_k_zero_lower_bound_is_zero() -> None:
    # 0 successes out of n trials — lower bound should hit the 0 floor.
    low, high = wilson_interval(0, 10)
    assert low == 0.0
    # Upper bound must be strictly positive (Wilson differs from Normal here).
    assert high > 0.0


def test_wilson_k_equals_n_upper_bound_is_one() -> None:
    # 10/10 — upper bound hits the 1.0 ceiling, lower bound strictly below 1.
    low, high = wilson_interval(10, 10)
    assert high == 1.0
    assert low < 1.0
    # And low is notably less than 1.0 — Wilson shrinks from a naive point estimate.
    assert low < 0.95


def test_wilson_interval_width_shrinks_with_more_data() -> None:
    # At n=10, p̂=0.5 the interval is wider than at n=100.
    w_small = wilson_interval(5, 10)
    w_large = wilson_interval(50, 100)
    assert (w_small[1] - w_small[0]) > (w_large[1] - w_large[0])


# ---------------------------------------------------------------------
# confidence_label
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "n, expected",
    [
        (0, "low"),
        (1, "low"),
        (2, "low"),
        (3, "medium"),
        (4, "medium"),
        (5, "medium"),
        (6, "high"),
        (10, "high"),
    ],
)
def test_confidence_label_boundaries(n: int, expected: str) -> None:
    assert confidence_label(n) == expected


# ---------------------------------------------------------------------
# compute_rules — 9-row synthetic fixture
# ---------------------------------------------------------------------


def _nine_row_fixture() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build a 9-completed-row frame with enough variance to emit rules.

    Three project_types × three regions, with a mix of high and low
    outcomes so at least one segment crosses each threshold.
    """
    rows = [
        # Infrastructure / Northeast — all high-overrun, all have disputes.
        {"id": "a1", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 80_000_000, "subcontractor_count": 20,
         "delay_days": 200, "cost_overrun_pct": 30.0, "safety_incidents": 2,
         "payment_disputes": 3, "final_status": "Completed",
         "actual_duration_days": 900},
        {"id": "a2", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 90_000_000, "subcontractor_count": 25,
         "delay_days": 160, "cost_overrun_pct": 28.0, "safety_incidents": 3,
         "payment_disputes": 2, "final_status": "Completed",
         "actual_duration_days": 1000},
        {"id": "a3", "project_type": "Infrastructure", "region": "Northeast",
         "contract_value_usd": 70_000_000, "subcontractor_count": 18,
         "delay_days": 180, "cost_overrun_pct": 27.0, "safety_incidents": 1,
         "payment_disputes": 1, "final_status": "Completed",
         "actual_duration_days": 800},
        # Commercial / Southeast — clean projects, no high overrun/delay.
        {"id": "b1", "project_type": "Commercial", "region": "Southeast",
         "contract_value_usd": 25_000_000, "subcontractor_count": 5,
         "delay_days": 5, "cost_overrun_pct": 1.0, "safety_incidents": 0,
         "payment_disputes": 0, "final_status": "Completed",
         "actual_duration_days": 400},
        {"id": "b2", "project_type": "Commercial", "region": "Southeast",
         "contract_value_usd": 30_000_000, "subcontractor_count": 6,
         "delay_days": 10, "cost_overrun_pct": 2.0, "safety_incidents": 0,
         "payment_disputes": 0, "final_status": "Completed",
         "actual_duration_days": 420},
        {"id": "b3", "project_type": "Commercial", "region": "Southeast",
         "contract_value_usd": 35_000_000, "subcontractor_count": 7,
         "delay_days": 8, "cost_overrun_pct": 1.5, "safety_incidents": 0,
         "payment_disputes": 0, "final_status": "Completed",
         "actual_duration_days": 450},
        # Industrial / Midwest — mixed.
        {"id": "c1", "project_type": "Industrial", "region": "Midwest",
         "contract_value_usd": 18_000_000, "subcontractor_count": 4,
         "delay_days": 20, "cost_overrun_pct": 5.0, "safety_incidents": 1,
         "payment_disputes": 0, "final_status": "Completed",
         "actual_duration_days": 500},
        {"id": "c2", "project_type": "Industrial", "region": "Midwest",
         "contract_value_usd": 22_000_000, "subcontractor_count": 6,
         "delay_days": 30, "cost_overrun_pct": 7.0, "safety_incidents": 2,
         "payment_disputes": 1, "final_status": "Completed",
         "actual_duration_days": 550},
        {"id": "c3", "project_type": "Industrial", "region": "Midwest",
         "contract_value_usd": 20_000_000, "subcontractor_count": 5,
         "delay_days": 25, "cost_overrun_pct": 6.0, "safety_incidents": 1,
         "payment_disputes": 1, "final_status": "Completed",
         "actual_duration_days": 520},
    ]
    df = pd.DataFrame(rows)

    # Build a matching segments frame — size_bucket derived from contract value.
    segments = pd.DataFrame({
        "project_id": df["id"].values,
        "size_bucket": [
            "large", "large", "medium",
            "medium", "medium", "medium",
            "small", "small", "small",
        ],
    })
    return df, segments


def test_compute_rules_emits_rules_for_clear_segments() -> None:
    df, segments = _nine_row_fixture()
    rules = compute_rules(df, segments)

    assert len(rules) > 0

    # Every rule row must carry the full contract.
    for rule in rules:
        assert set(rule.keys()) == {
            "scope", "outcome", "rate", "sample_size",
            "ci_low", "ci_high", "confidence",
        }
        # sample_size < 3 is only allowed when the rate is an absolute
        # signal (0.0 or 1.0). See drivers._should_emit.
        if rule["sample_size"] < 3:
            assert rule["rate"] in (0.0, 1.0)


def test_compute_rules_finds_infrastructure_high_overrun() -> None:
    df, segments = _nine_row_fixture()
    rules = compute_rules(df, segments)

    # Infrastructure — 3/3 high-overrun → rate 1.0, high-ish confidence.
    match = [
        r for r in rules
        if r["scope"] == "project_type=Infrastructure" and r["outcome"] == "high_overrun"
    ]
    assert len(match) == 1
    rule = match[0]
    assert rule["rate"] == 1.0
    assert rule["sample_size"] == 3
    assert rule["confidence"] == "medium"
    # Wilson CI at k=n=3 caps high at 1.0.
    assert rule["ci_high"] == 1.0
    assert rule["ci_low"] < 1.0


def test_compute_rules_zero_rate_segment_also_emitted() -> None:
    df, segments = _nine_row_fixture()
    rules = compute_rules(df, segments)

    # Commercial — 0/3 high-overrun. rate=0.0 is an absolute signal and
    # must be emitted even though most outcomes are 0.
    match = [
        r for r in rules
        if r["scope"] == "project_type=Commercial" and r["outcome"] == "high_overrun"
    ]
    assert len(match) == 1
    assert match[0]["rate"] == 0.0
    assert match[0]["ci_low"] == 0.0
    assert match[0]["ci_high"] > 0.0  # Wilson gives us a real upper bound at k=0


def test_compute_rules_size_bucket_scope_present() -> None:
    df, segments = _nine_row_fixture()
    rules = compute_rules(df, segments)
    scopes = {r["scope"] for r in rules}
    # At least one rule per scope column.
    assert any(s.startswith("project_type=") for s in scopes)
    assert any(s.startswith("region=") for s in scopes)
    assert any(s.startswith("size_bucket=") for s in scopes)


def test_compute_rules_empty_df_returns_empty() -> None:
    empty = pd.DataFrame(
        columns=[
            "id", "project_type", "region", "final_status",
            "cost_overrun_pct", "delay_days", "safety_incidents",
            "payment_disputes",
        ]
    )
    empty_segments = pd.DataFrame(columns=["project_id", "size_bucket"])
    assert compute_rules(empty, empty_segments) == []
