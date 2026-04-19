"""
drivers.py — per-segment rate analysis with Wilson 95% CI.

Phase 8a · Enlaye Risk Intelligence platform.

For each (categorical scope × outcome predicate) pair, compute the rate
on the completed cohort, attach a Wilson score confidence interval and
a human-readable confidence label, and emit a rule row ready to persist
to `heuristic_rules`. The UI renders these as "Signals you should know"
cards — hence the emphasis on sample size transparency.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import pandas as pd


# WHY Wilson over Normal approximation: with n as low as 3 (our demo
# portfolio routinely has segments that small), the Normal-approximation
# CI on a 0% rate returns (0, 0) — a nonsense "we are certain" answer.
# Wilson produces a sensibly wide interval at small n without us having
# to special-case k=0 / k=n. Hand-rolled in ~8 lines to avoid pulling in
# scipy for one stat — see CLAUDE.md § Ask before new major dependencies.
def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Return the Wilson score 95% CI for k successes out of n trials.

    Edge cases:
      - n == 0: returns (0, 0) because there is nothing to estimate.
      - k == 0 or k == n: Wilson handles these gracefully (not like the
        Normal approximation which returns a zero-width interval).
    """
    if n <= 0:
        return (0.0, 0.0)

    k = max(0, min(int(k), int(n)))
    n_f = float(n)
    p_hat = k / n_f
    z_sq = z * z

    denominator = 1.0 + z_sq / n_f
    centre = (p_hat + z_sq / (2.0 * n_f)) / denominator
    half_width = (
        z * math.sqrt((p_hat * (1.0 - p_hat) / n_f) + (z_sq / (4.0 * n_f * n_f)))
    ) / denominator

    low = max(0.0, centre - half_width)
    high = min(1.0, centre + half_width)
    return (float(low), float(high))


def confidence_label(n: int) -> str:
    """Bucket the sample size into 'low' | 'medium' | 'high'.

    WHY these thresholds: the demo portfolio has 15 rows and ~9
    completed. A segment of n=3 is the smallest size where Wilson is
    informative; n=6 is roughly "half the completed cohort", the point
    at which we have earned some trust. These are deliberately generous
    at the high end because we do not want to flash 'high' on tiny data.
    """
    if n < 3:
        return "low"
    if n < 6:
        return "medium"
    return "high"


# ---------------------------------------------------------------------
# Rule configuration
# ---------------------------------------------------------------------


# Each predicate takes a completed-cohort DataFrame and returns a
# boolean Series ("did this project experience the outcome?").
# Everything here settles at project completion, so we compute rates on
# the completed subset only. See drivers.py module docstring.
_OUTCOME_PREDICATES: dict[str, Callable[[pd.DataFrame], pd.Series]] = {
    "high_overrun": lambda df: (df["cost_overrun_pct"] > 25.0).fillna(False),
    "high_delay": lambda df: (df["delay_days"] > 150.0).fillna(False),
    "any_safety_incident": lambda df: (df["safety_incidents"] >= 1).fillna(False),
    "any_dispute": lambda df: (df["payment_disputes"] >= 1).fillna(False),
}

# Scope columns we drill down by. `size_bucket` isn't in `projects` — it
# lives in the segments frame. `compute_rules` joins on project_id before
# iterating so the same loop handles all three.
_SCOPE_COLUMNS: tuple[str, ...] = ("project_type", "region", "size_bucket")


def _should_emit(n: int, rate: float) -> bool:
    """Rule emission gate.

    WHY the two-branch rule: sample_size>=3 is the Wilson-informative
    threshold; rate in {0.0, 1.0} is an "absolute signal" escape hatch
    — even on n=1 or n=2, "100% of this segment saw a dispute" is worth
    surfacing with a low-confidence label. Without this escape, the UI
    would hide the two most striking patterns in a 15-row demo.
    """
    if n >= 3:
        return True
    return rate in (0.0, 1.0)


def compute_rules(
    df: pd.DataFrame,
    segments_df: pd.DataFrame,
) -> list[dict[str, Any]]:
    """Compute heuristic rules across (scope × outcome).

    `df` is the portfolio's projects frame (must include `id`,
    `final_status`, and the outcome columns). `segments_df` carries
    `project_id` + `size_bucket` and is joined in so `size_bucket`
    behaves like any other scope column.
    """
    if df.empty:
        return []

    working = df.copy()

    # WHY the left join on id: segments_df is authoritative for
    # size_bucket, but we want to loop over projects rows so the
    # completed filter stays simple. Join brings size_bucket alongside.
    if not segments_df.empty and "project_id" in segments_df.columns:
        working = working.merge(
            segments_df[["project_id", "size_bucket"]],
            left_on="id",
            right_on="project_id",
            how="left",
        )
    else:
        working["size_bucket"] = None

    completed = working[working["final_status"] == "Completed"].copy()
    if completed.empty:
        return []

    rules: list[dict[str, Any]] = []
    for scope_col in _SCOPE_COLUMNS:
        if scope_col not in completed.columns:
            continue
        # groupby drops NaN groups by default — that's what we want here,
        # because a null project_type isn't a meaningful segment to rule on.
        for scope_value, segment_df in completed.groupby(scope_col):
            if scope_value is None or (
                isinstance(scope_value, float) and math.isnan(scope_value)
            ):
                continue
            n = int(len(segment_df))
            if n == 0:
                continue

            for outcome_name, predicate in _OUTCOME_PREDICATES.items():
                hits_mask = predicate(segment_df)
                k = int(hits_mask.sum())
                rate = float(k) / float(n) if n > 0 else 0.0

                if not _should_emit(n, rate):
                    continue

                ci_low, ci_high = wilson_interval(k, n)

                rules.append(
                    {
                        # WHY: the scope string is a URL-ish selector the
                        # UI can parse into a filter ("project_type=
                        # Infrastructure" → filter the projects table by
                        # that type). Keeping it a single text column
                        # means no schema churn when we add new scopes.
                        "scope": f"{scope_col}={scope_value}",
                        "outcome": outcome_name,
                        "rate": round(rate, 4),
                        "sample_size": n,
                        "ci_low": round(ci_low, 4),
                        "ci_high": round(ci_high, 4),
                        "confidence": confidence_label(n),
                    }
                )

    return rules
