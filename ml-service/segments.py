"""
segments.py — per-project derived features.

Phase 8a · Enlaye Risk Intelligence platform.

Three pure functions + one frame builder, no IO, no DB. Produces the
rows that populate `project_segments`:
  - size_bucket         (cheap $-threshold lookup)
  - normalized_delay    (delay divided by duration, None-safe)
  - cluster_id          (KMeans assignment on one-hot + log-scaled features)

See ARCHITECTURE.md § Database Schema for the target table columns and
CLAUDE.md § Critical Non-Negotiables (#5, median over mean) for the NaN
handling stance.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans


# WHY: thresholds chosen to split the 15-row demo into a usable 3-way
# bucket (small=Industrial/Residential, medium=most Commercial, large=
# mega-infrastructure). Hard-coded because they're a product decision,
# not a config knob; revisit when real data lands.
_SMALL_CEILING_USD: float = 25_000_000.0
_MEDIUM_CEILING_USD: float = 75_000_000.0


def _is_missing(value: object) -> bool:
    """True for None, NaN, pd.NA, NaT — any flavor of 'unknown'.

    WHY a helper: pandas ships at least four distinct null sentinels
    (None, float NaN, pd.NA, pd.NaT) and `pd.isna` is the only predicate
    that handles all of them uniformly. Use this everywhere we accept a
    scalar that might come from a nullable column.
    """
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def size_bucket(contract_value_usd: float | int | None) -> str:
    """Return 'small', 'medium', or 'large' for a contract value.

    WHY: None/0/NaN all land in 'small' — we don't fabricate a bucket
    for missing data, and the downstream risk score will still surface
    the low confidence via its flags. Treating None as 'small' keeps
    the DB check constraint satisfied without adding a nullable column.
    """
    if _is_missing(contract_value_usd):
        return "small"
    value = float(contract_value_usd)  # type: ignore[arg-type]
    if value < _SMALL_CEILING_USD:
        return "small"
    if value < _MEDIUM_CEILING_USD:
        return "medium"
    return "large"


def normalized_delay(
    delay_days: float | int | None,
    actual_duration_days: float | int | None,
) -> float | None:
    """Return delay_days / (actual_duration_days + 1), or None when unknown.

    WHY the +1: projects with a same-day start/end would divide by zero.
    The +1 smoother also dampens the metric for very short jobs where a
    one-day delay isn't the same signal as a one-day delay on a year-long
    build. Returns None on any NaN/None input — callers treat None as
    "not computable yet" (in-progress rows).
    """
    if _is_missing(delay_days) or _is_missing(actual_duration_days):
        return None
    duration = float(actual_duration_days)  # type: ignore[arg-type]
    if duration < 0:
        # Negative durations shouldn't happen (cleaning enforces end >= start),
        # but if one slipped through, the +1 denominator would be <=0 for
        # duration=-1. Bail out rather than produce a nonsense ratio.
        return None
    return float(delay_days) / (duration + 1.0)  # type: ignore[arg-type]


# WHY: the clustering feature list matches what the scenario simulator
# (phase 8b) will use for nearest-cohort lookup. Keeping them aligned
# means a project's cluster_id and its "similar projects" ranking agree
# on what "similar" means.
_CATEGORICAL_CLUSTER_COLS: tuple[str, ...] = ("project_type", "region")
_NUMERIC_CLUSTER_COLS: tuple[str, ...] = ("log_contract_value", "subcontractor_count")


def _build_cluster_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Assemble the numeric feature matrix KMeans fits on.

    Inputs come from the cleaned `projects` frame; we compute
    `log1p(contract_value_usd)` here (not in the caller) so the
    transformation is co-located with its consumer and tests can pin the
    shape without replicating the log step.
    """
    working = df.copy()

    # WHY: portfolio-median fill for missing contract value — same
    # rationale as cleaning.py (mean gets dragged by mega-projects).
    # Subcontractor_count is already imputed by the cleaning pipeline on
    # completed rows; any stragglers on in-progress rows get median-filled
    # here defensively so KMeans doesn't crash on NaN.
    for col in ("contract_value_usd", "subcontractor_count"):
        if col not in working.columns:
            working[col] = 0.0
        median = working[col].dropna().median()
        # If every row is NaN, fall back to zero so we don't propagate NaN.
        fill_value = 0.0 if pd.isna(median) else float(median)
        working[col] = working[col].fillna(fill_value)

    working["log_contract_value"] = np.log1p(working["contract_value_usd"].astype(float))

    # One-hot encode the categoricals. drop_first=False so KMeans sees
    # every category as its own axis (the demo has 4 project_types and
    # 5 regions; losing one reference level would pull clusters toward
    # that omitted category).
    categorical_frame = working[list(_CATEGORICAL_CLUSTER_COLS)].fillna("unknown")
    dummies = pd.get_dummies(
        categorical_frame,
        columns=list(_CATEGORICAL_CLUSTER_COLS),
        drop_first=False,
        dtype=float,
    )

    numeric_frame = working[list(_NUMERIC_CLUSTER_COLS)].astype(float)
    return pd.concat([numeric_frame, dummies], axis=1)


def assign_clusters(df: pd.DataFrame, k: int = 3) -> pd.Series:
    """Return a Series of cluster_ids indexed to match df.

    The effective cluster count is clamped so that a tiny portfolio (e.g.
    the 15-row demo, or a 4-row fresh upload) doesn't try to split into
    10 groups. WHY the n//3 heuristic: KMeans needs ~3 rows per cluster
    to produce anything more than "the row IS the cluster". At n<4 there
    is no meaningful structure to extract — we return all zeros and let
    the UI treat it as "ungrouped" via a single bucket.
    """
    n = len(df)
    if n < 4:
        # WHY: zero-cluster sentinel. Downstream callers should interpret
        # "every project in cluster 0" as "no useful clustering possible".
        return pd.Series([0] * n, index=df.index, dtype=int)

    effective_k = max(2, min(k, n // 3))

    features = _build_cluster_feature_frame(df)

    # WHY n_init=10: sklearn's default dropped from 10 to 'auto' in 1.4;
    # pinning 10 keeps behaviour stable across sklearn versions so test
    # fixtures don't flip cluster labels on a minor bump.
    model = KMeans(n_clusters=effective_k, n_init=10, random_state=42)
    labels = model.fit_predict(features.values)
    return pd.Series(labels, index=df.index, dtype=int)


def compute_segments_df(df: pd.DataFrame) -> pd.DataFrame:
    """End-to-end: cleaned projects frame → segment rows.

    Returns a DataFrame with `project_id, size_bucket, normalized_delay,
    cluster_id` — ready to zip up with portfolio_id and insert.

    Expects `df` to carry an `id` column (the projects.id UUID). Callers
    hand it the SELECT result from `projects` straight from Supabase.
    """
    if df.empty:
        return pd.DataFrame(
            columns=["project_id", "size_bucket", "normalized_delay", "cluster_id"]
        )

    buckets = df["contract_value_usd"].apply(size_bucket)

    # WHY apply with a lambda rather than a vectorized expression: the
    # +1 smoother plus None-propagation is easiest to read row-by-row,
    # and 15 rows is not a perf concern. If this moves off the write
    # path (see risk comment in the phase plan) we can vectorize.
    delays = df.apply(
        lambda row: normalized_delay(
            row.get("delay_days"),
            row.get("actual_duration_days"),
        ),
        axis=1,
    )

    clusters = assign_clusters(df)

    return pd.DataFrame(
        {
            "project_id": df["id"].values,
            "size_bucket": buckets.values,
            "normalized_delay": delays.values,
            "cluster_id": clusters.values,
        }
    )
