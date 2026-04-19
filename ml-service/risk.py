"""
risk.py — composite risk score per project, with transparent breakdown.

Phase 8a · Enlaye Risk Intelligence platform.

Outputs a 0-100 score + a jsonb-shaped breakdown describing each
sub-score, the weight applied, the top contributor, and any "we defaulted
this because the data is sparse" flags. The breakdown is the whole point
— the UI renders "why this score" by reading it back. See plan §
"interpretability/trust primitives".
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from segments import normalized_delay


# WHY equal weights: with 15 rows and no validation set, weight tuning
# would be cargo-culting. Equal weights are defensible, easy to explain,
# and easy to swap later when real data provides ground truth. Stored
# alongside subscores in the breakdown so a future weighted version is
# a one-line change without schema churn.
_WEIGHTS: dict[str, float] = {
    "type_risk": 0.2,
    "region_risk": 0.2,
    "size_risk": 0.2,
    "complexity_risk": 0.2,
    "duration_risk": 0.2,
}

# WHY these thresholds: same as cleaning.ANOMALY_RULES for cost_overrun.
# Keeping them in lockstep means "high risk type" and "anomaly-flagged
# cost overrun" agree on what counts as high. If cleaning.py's constants
# change, update here too.
_HIGH_OVERRUN_PCT: float = 25.0
_DEFAULT_SPARSE_SCORE: float = 0.5
_DEFAULT_UNKNOWN_DURATION_SCORE: float = 0.5


def _safe_fraction(numerator: int, denominator: int) -> float:
    """Return numerator/denominator, or 0.0 when denominator is 0."""
    if denominator <= 0:
        return 0.0
    return float(numerator) / float(denominator)


def _is_completed(row: pd.Series) -> bool:
    return row.get("final_status") == "Completed"


def _type_risk(
    row: pd.Series,
    completed_by_type: dict[str, pd.DataFrame],
) -> tuple[float, list[str]]:
    """Fraction of completed peers in this project_type with cost_overrun > 25%.

    Returns (score, flags). If the type has no completed peers, we
    default to 0.5 and emit `sparse_type` so the UI can downweight it.
    """
    project_type = row.get("project_type")
    flags: list[str] = []
    if project_type is None or project_type not in completed_by_type:
        return _DEFAULT_SPARSE_SCORE, ["sparse_type"]
    peers = completed_by_type[project_type]
    if peers.empty:
        return _DEFAULT_SPARSE_SCORE, ["sparse_type"]
    # WHY: boolean mask on the peer frame, not the whole portfolio.
    # `cost_overrun_pct` on completed rows is non-null after cleaning,
    # but we guard with `.fillna(False)` defensively — a future sparse
    # schema change shouldn't silently count NaN as "yes".
    high = (peers["cost_overrun_pct"] > _HIGH_OVERRUN_PCT).fillna(False).sum()
    rate = _safe_fraction(int(high), int(len(peers)))
    return float(rate), flags


def _region_risk(
    row: pd.Series,
    completed_by_region: dict[str, pd.DataFrame],
) -> tuple[float, list[str]]:
    """Fraction of completed peers in this region with payment_disputes >= 1.

    WHY payment_disputes as the region signal: regional variation in
    construction is most interpretable through payment culture (escrow
    norms, lien law). Overrun and delay correlate with project type;
    disputes correlate with jurisdiction.
    """
    region = row.get("region")
    flags: list[str] = []
    if region is None or region not in completed_by_region:
        return _DEFAULT_SPARSE_SCORE, ["sparse_region"]
    peers = completed_by_region[region]
    if peers.empty:
        return _DEFAULT_SPARSE_SCORE, ["sparse_region"]
    disputes = (peers["payment_disputes"] >= 1).fillna(False).sum()
    rate = _safe_fraction(int(disputes), int(len(peers)))
    return float(rate), flags


def _size_risk(contract_value: float | None, max_log_contract: float) -> float:
    """Log-scaled size pressure in [0, 1].

    WHY log not linear: contract values span two orders of magnitude
    (15M to 120M in the demo). Linear would compress everything below
    the megaproject to indistinguishable tiny scores. log1p gives us a
    smooth ramp where doubling the contract doubles the risk bump.
    """
    if contract_value is None or (
        isinstance(contract_value, float) and math.isnan(contract_value)
    ):
        return 0.0
    if max_log_contract <= 0:
        return 0.0
    # Clamp to [0, 1]: a project larger than the portfolio max (e.g. a
    # newly inserted mega-project) should cap at 1.0, not overshoot.
    return float(min(1.0, np.log1p(float(contract_value)) / max_log_contract))


def _complexity_risk(subcontractor_count: float | None, cohort_max_subs: int) -> float:
    """Subcontractor count as a fraction of cohort max.

    WHY subcontractor_count: the tightest available proxy for
    coordination complexity in the demo data. More subs → more
    interfaces → more ways for a schedule to slip.
    """
    if subcontractor_count is None or (
        isinstance(subcontractor_count, float) and math.isnan(subcontractor_count)
    ):
        return 0.0
    denom = max(1, int(cohort_max_subs))
    return float(min(1.0, float(subcontractor_count) / denom))


def _duration_risk(row: pd.Series) -> tuple[float, list[str]]:
    """Delay-normalized duration pressure, or defaulted if still running."""
    flags: list[str] = []
    if not _is_completed(row):
        # WHY: an in-progress row has no settled delay. We surface 0.5 as
        # "we don't know yet" and tag the flag so the UI can visually
        # mute this dimension. Scoring an unknown as 0 would falsely
        # reassure; scoring as 1 would unjustly penalize.
        return _DEFAULT_UNKNOWN_DURATION_SCORE, ["unknown_duration"]

    nd = normalized_delay(row.get("delay_days"), row.get("actual_duration_days"))
    if nd is None:
        return _DEFAULT_UNKNOWN_DURATION_SCORE, ["unknown_duration"]
    return float(min(1.0, max(0.0, nd))), flags


def _group_completed(df: pd.DataFrame, col: str) -> dict[str, pd.DataFrame]:
    """Build a {value: completed_peers} lookup keyed by col.

    Keyed upfront so per-project sub-score computation is O(1) lookups
    instead of re-filtering the full frame for every row.
    """
    completed = df[df["final_status"] == "Completed"]
    if completed.empty or col not in completed.columns:
        return {}
    return {value: group for value, group in completed.groupby(col)}


def compute_scores(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Compute risk scores for every project in `df`.

    Returns a list of `{project_id, score, breakdown}` dicts. `score`
    is a 0-100 integer-rounded composite; `breakdown` is the jsonb-shape
    described in the module docstring.
    """
    if df.empty:
        return []

    # Portfolio-level denominators — computed once so per-row scoring is
    # cheap. Guarded for missing columns / all-NaN edge cases.
    portfolio_max_contract = float(df["contract_value_usd"].max() or 0.0)
    max_log_contract = float(np.log1p(portfolio_max_contract)) if portfolio_max_contract > 0 else 0.0

    subs_series = df["subcontractor_count"].dropna() if "subcontractor_count" in df.columns else pd.Series(dtype=float)
    cohort_max_subs = int(subs_series.max()) if not subs_series.empty else 1

    completed_by_type = _group_completed(df, "project_type")
    completed_by_region = _group_completed(df, "region")

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        type_score, type_flags = _type_risk(row, completed_by_type)
        region_score, region_flags = _region_risk(row, completed_by_region)
        size_score = _size_risk(row.get("contract_value_usd"), max_log_contract)
        complexity_score = _complexity_risk(row.get("subcontractor_count"), cohort_max_subs)
        duration_score, duration_flags = _duration_risk(row)

        subscores: dict[str, float] = {
            "type_risk": round(float(type_score), 4),
            "region_risk": round(float(region_score), 4),
            "size_risk": round(float(size_score), 4),
            "complexity_risk": round(float(complexity_score), 4),
            "duration_risk": round(float(duration_score), 4),
        }

        # WHY weighted sum then *100 rounded: keeps the score an integer
        # so the DB numeric and the UI dial agree; the jsonb breakdown
        # preserves the un-rounded sub-scores for drill-down.
        weighted = sum(subscores[k] * _WEIGHTS[k] for k in _WEIGHTS)
        score = int(round(100.0 * weighted))
        # Defensive clamp — equal weights over [0,1] subscores can't
        # exceed 100, but floating-point rounding could.
        score = max(0, min(100, score))

        top_driver = max(
            subscores,
            key=lambda k: subscores[k] * _WEIGHTS[k],
        )

        flags = list(dict.fromkeys(type_flags + region_flags + duration_flags))

        rows.append(
            {
                "project_id": row.get("id"),
                "score": score,
                "breakdown": {
                    "subscores": subscores,
                    "weights": dict(_WEIGHTS),
                    "top_driver": top_driver,
                    "flags": flags,
                },
            }
        )

    return rows
