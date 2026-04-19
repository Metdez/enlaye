"""
scenarios.py — cohort-based scenario simulator.

Phase 8b · Enlaye Risk Intelligence platform.

Given a hypothetical project's inputs (project_type, region, contract
value, subcontractor count) and the portfolio's historical projects,
return a **distribution** over outcomes on the K nearest real projects —
not a point prediction.

Design pillars (mirror the plan):
  - No point predictions. We return P25/P50/P75 ranges plus n and a
    confidence label, so the UI can surface "this is a range over 5
    similar projects" rather than "we predict X days of delay".
  - Feature space matches `segments.assign_clusters` so the KNN cohort
    and the KMeans cluster agree on what "similar" means.
  - Cosine distance over (one-hot type, one-hot region, log contract,
    subcontractor count). See `nearest_cohort` for the WHY.
  - Wilson 95% CI reused from `drivers` — no scipy dep.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_distances

from drivers import wilson_interval


# WHY: keep the feature ordering pinned and public so tests can pin the
# shape without duplicating the encoder. The (type, region) one-hot
# columns are named with their prefix so a query vector for an unseen
# category drops cleanly into an all-zeros column.
_CATEGORICAL_CLUSTER_COLS: tuple[str, ...] = ("project_type", "region")
_NUMERIC_CLUSTER_COLS: tuple[str, ...] = (
    "log_contract_value",
    "subcontractor_count",
)

# WHY: confidence thresholds match drivers.confidence_label so the UI
# only has to learn one set of buckets. Re-declared here (not imported)
# because the rate path has an empty-cohort edge case that needs a
# distinct "low" return rather than a NaN.
_CONFIDENCE_LOW_MAX = 3   # n < 3 → low
_CONFIDENCE_HIGH_MIN = 6  # n >= 6 → high


# ---------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------


def _portfolio_fallback_contract_value(df: pd.DataFrame) -> float:
    """Median contract value used to fill NaNs in both matrix and query.

    WHY median: construction contract values are long-tailed; a mega
    project would pull the mean and make every "typical" query look
    artificially small. Mirrors cleaning.py / segments.py.
    """
    if "contract_value_usd" not in df.columns or df.empty:
        return 0.0
    values = df["contract_value_usd"].astype(float).dropna()
    if values.empty:
        return 0.0
    return float(values.median())


def encode_projects_matrix(df: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
    """Vectorize projects in the same feature space as `segments.assign_clusters`.

    Features (in fixed order):
      - log1p(contract_value_usd)
      - subcontractor_count
      - one-hot project_type (prefix `project_type=`)
      - one-hot region       (prefix `region=`)

    Returns (matrix, feature_names). NaN `contract_value_usd` is filled
    with the portfolio median — same convention as segments.assign_clusters.
    `subcontractor_count` defensively filled the same way so the cosine
    distance call never sees NaN.
    """
    if df.empty:
        # Preserve a stable feature-names shape even on an empty portfolio
        # so callers can construct a query vector that will just be
        # unused. Numeric columns are guaranteed present by convention.
        feature_names = [
            "log_contract_value",
            "subcontractor_count",
        ]
        return np.zeros((0, len(feature_names)), dtype=float), feature_names

    working = df.copy()

    # WHY median fill (see module docstring + segments.py):
    fallback = _portfolio_fallback_contract_value(working)
    for col in ("contract_value_usd", "subcontractor_count"):
        if col not in working.columns:
            working[col] = 0.0
        median = working[col].dropna().astype(float).median()
        fill_value = fallback if col == "contract_value_usd" and pd.isna(median) else median
        if pd.isna(fill_value):
            fill_value = 0.0
        working[col] = working[col].fillna(float(fill_value)).astype(float)

    working["log_contract_value"] = np.log1p(working["contract_value_usd"].astype(float))

    # WHY one-hot with a named prefix (e.g. `project_type=Infrastructure`):
    # it makes the query-vector path trivial — just look up the column by
    # its prefix+value. Missing categoricals fall back to "unknown" which
    # carries its own column so they don't contaminate known categories.
    cat_frame = working[list(_CATEGORICAL_CLUSTER_COLS)].fillna("unknown")
    dummies = pd.get_dummies(
        cat_frame,
        columns=list(_CATEGORICAL_CLUSTER_COLS),
        prefix_sep="=",
        drop_first=False,
        dtype=float,
    )

    numeric_frame = working[list(_NUMERIC_CLUSTER_COLS)].astype(float)
    combined = pd.concat([numeric_frame, dummies], axis=1)
    feature_names = list(combined.columns)
    return combined.to_numpy(dtype=float), feature_names


def encode_query_vector(
    project_type: str,
    region: str,
    contract_value_usd: float,
    subcontractor_count: int,
    feature_names: list[str],
    fallback_contract_value: float,
) -> np.ndarray:
    """Build a 1×N query vector aligned to `feature_names`.

    Unseen categories (e.g. a type the portfolio has never had) land as
    all-zeros across the one-hot columns for that categorical — the
    KNN will then rank by numeric similarity alone, which is a sensible
    degenerate behaviour rather than a crash.
    """
    # WHY: NaN fallback for contract value uses the portfolio median so a
    # completely unknown project inherits the "typical" size signal
    # instead of landing at zero and looking like a tiny project.
    value = (
        float(contract_value_usd)
        if contract_value_usd is not None and not pd.isna(contract_value_usd)
        else float(fallback_contract_value)
    )
    subs = (
        int(subcontractor_count)
        if subcontractor_count is not None and not pd.isna(subcontractor_count)
        else 0
    )

    vec = np.zeros((1, len(feature_names)), dtype=float)
    for idx, name in enumerate(feature_names):
        if name == "log_contract_value":
            vec[0, idx] = float(np.log1p(max(0.0, value)))
        elif name == "subcontractor_count":
            vec[0, idx] = float(subs)
        elif name == f"project_type={project_type}":
            vec[0, idx] = 1.0
        elif name == f"region={region}":
            vec[0, idx] = 1.0
        # else: leave at 0.0 — unseen categories silently drop, which is
        # documented above.
    return vec


# ---------------------------------------------------------------------
# Nearest cohort
# ---------------------------------------------------------------------


def nearest_cohort(
    df: pd.DataFrame,
    query: dict,
    k: int = 5,
) -> pd.DataFrame:
    """K-nearest-neighbor lookup in the encoded feature space.

    WHY cosine not euclidean: the one-hot categorical columns are 0/1
    and the numeric columns are log-scaled but still unbounded. On raw
    Euclidean distance, the `log_contract_value` axis (≈18 for a $60M
    contract) drowns out every categorical match (max 1.0). Cosine
    normalizes magnitude so "same type, same region, roughly same size"
    beats "very different type but same size".

    Returns a slice of `df` for the k nearest rows. If n < k, returns all
    rows (ordered by distance). If n == 0, returns an empty frame.
    """
    if df.empty:
        return df.iloc[0:0]

    matrix, feature_names = encode_projects_matrix(df)
    if matrix.shape[0] == 0:
        return df.iloc[0:0]

    fallback = _portfolio_fallback_contract_value(df)
    query_vec = encode_query_vector(
        project_type=str(query.get("project_type", "")),
        region=str(query.get("region", "")),
        contract_value_usd=float(query.get("contract_value_usd", 0.0) or 0.0),
        subcontractor_count=int(query.get("subcontractor_count", 0) or 0),
        feature_names=feature_names,
        fallback_contract_value=fallback,
    )

    # WHY: cosine_distances returns 0 for identical vectors and 2 for
    # opposite ones. argsort ascending gives nearest first. When the
    # query vector is all zeros (empty portfolio edge case) cosine is
    # undefined; guard with a tiny epsilon on the norm check.
    query_norm = float(np.linalg.norm(query_vec))
    if query_norm < 1e-12:
        # Degenerate: fall back to the first k rows in insertion order so
        # the caller still gets a cohort instead of an exception.
        return df.head(k).copy()

    distances = cosine_distances(query_vec, matrix)[0]
    # np.argsort is stable, so ties resolve by original order — makes
    # tests deterministic when multiple rows are equidistant.
    order = np.argsort(distances, kind="stable")
    take = min(k, len(order))
    selected_positions = order[:take]
    return df.iloc[selected_positions].copy()


# ---------------------------------------------------------------------
# Cohort statistics
# ---------------------------------------------------------------------


def _confidence_from_n(n: int) -> str:
    """Same thresholds as drivers.confidence_label, re-stated locally so
    the rate path's n==0 branch doesn't need to import and reinterpret."""
    if n < _CONFIDENCE_LOW_MAX:
        return "low"
    if n < _CONFIDENCE_HIGH_MIN:
        return "medium"
    return "high"


def cohort_range(cohort_df: pd.DataFrame, outcome_col: str) -> dict:
    """Return {p25, p50, p75, n, confidence} for a numeric outcome.

    - n counts non-null values of `outcome_col` in `cohort_df`.
    - Percentiles via np.nanpercentile (returns None when n == 0).
    - Confidence: low if n<3, medium if 3<=n<6, high if n>=6.
    """
    if cohort_df.empty or outcome_col not in cohort_df.columns:
        return {
            "p25": None,
            "p50": None,
            "p75": None,
            "n": 0,
            "confidence": "low",
        }

    # WHY: coerce to numeric first so a string cell (shouldn't happen in
    # our schema, but defensive) becomes NaN and gets dropped rather
    # than blowing up nanpercentile.
    values = pd.to_numeric(cohort_df[outcome_col], errors="coerce")
    values = values.dropna()
    n = int(len(values))
    if n == 0:
        return {
            "p25": None,
            "p50": None,
            "p75": None,
            "n": 0,
            "confidence": "low",
        }

    arr = values.to_numpy(dtype=float)
    return {
        "p25": float(np.nanpercentile(arr, 25)),
        "p50": float(np.nanpercentile(arr, 50)),
        "p75": float(np.nanpercentile(arr, 75)),
        "n": n,
        "confidence": _confidence_from_n(n),
    }


def cohort_rate(
    cohort_df: pd.DataFrame,
    predicate_fn: Callable[[pd.Series], bool | None],
) -> dict:
    """Return {rate, ci_low, ci_high, n, confidence} for a binary predicate.

    `predicate_fn(row)` returns True / False / None (None = missing,
    excluded from both numerator and denominator). Wilson 95% CI is
    computed via the shared helper in drivers.
    """
    if cohort_df.empty:
        return {
            "rate": None,
            "ci_low": 0.0,
            "ci_high": 0.0,
            "n": 0,
            "confidence": "low",
        }

    successes = 0
    trials = 0
    for _, row in cohort_df.iterrows():
        try:
            verdict = predicate_fn(row)
        except Exception:  # noqa: BLE001 — row may have NaN columns; treat as missing
            verdict = None
        if verdict is None:
            continue
        trials += 1
        if bool(verdict):
            successes += 1

    if trials == 0:
        return {
            "rate": None,
            "ci_low": 0.0,
            "ci_high": 0.0,
            "n": 0,
            "confidence": "low",
        }

    rate = float(successes) / float(trials)
    ci_low, ci_high = wilson_interval(successes, trials)
    return {
        "rate": rate,
        "ci_low": float(ci_low),
        "ci_high": float(ci_high),
        "n": trials,
        "confidence": _confidence_from_n(trials),
    }


# ---------------------------------------------------------------------
# Outcome predicates + orchestration
# ---------------------------------------------------------------------


def _any_dispute(row: pd.Series) -> bool | None:
    """Did the project have at least one payment dispute?

    Returns None when payment_disputes is missing — treated as "unknown"
    rather than "no dispute" so the cohort rate isn't biased downward by
    in-progress rows that haven't settled yet.
    """
    value = row.get("payment_disputes")
    if value is None or pd.isna(value):
        return None
    try:
        return int(value) >= 1
    except (TypeError, ValueError):
        return None


def _caveats_for_cohort(cohort_size: int) -> list[str]:
    """Build the UI-facing caveat strings.

    WHY a list not a single string: the UI renders each caveat as its
    own chip so they can wrap cleanly on narrow layouts. Keeping this
    as a list (even with one element) matches the response schema.
    """
    caveats: list[str] = []
    if cohort_size == 0:
        caveats.append("No similar projects in this portfolio — no cohort to draw from.")
    elif cohort_size < 5:
        caveats.append(
            f"n<5 cohort (n={cohort_size}) — treat ranges as directional, not predictive."
        )
    return caveats


def simulate(
    df: pd.DataFrame,
    query: dict,
    k: int = 5,
) -> dict:
    """End-to-end: find nearest cohort, compute outcome ranges, return payload.

    Return schema (see main.py SimulateResponse for the Pydantic mirror):
      {
        "cohort_size": int,
        "k_requested": int,
        "similar_project_ids": list[str],
        "outcomes": {
          "delay_days": {p25, p50, p75, n, confidence},
          "cost_overrun_pct": {p25, p50, p75, n, confidence},
          "safety_incidents": {p25, p50, p75, n, confidence},
          "any_dispute": {rate, ci_low, ci_high, n, confidence},
        },
        "caveats": list[str],
      }
    """
    cohort = nearest_cohort(df, query, k=k)
    cohort_size = int(len(cohort))

    # WHY: cast ids to str so a UUID column (Postgres uuid) serializes
    # cleanly to JSON without relying on the Supabase SDK's own coercion.
    similar_ids: list[str] = []
    if cohort_size > 0 and "id" in cohort.columns:
        similar_ids = [str(v) for v in cohort["id"].tolist() if v is not None]

    outcomes: dict[str, Any] = {
        "delay_days": cohort_range(cohort, "delay_days"),
        "cost_overrun_pct": cohort_range(cohort, "cost_overrun_pct"),
        "safety_incidents": cohort_range(cohort, "safety_incidents"),
        "any_dispute": cohort_rate(cohort, _any_dispute),
    }

    return {
        "cohort_size": cohort_size,
        "k_requested": int(k),
        "similar_project_ids": similar_ids,
        "outcomes": outcomes,
        "caveats": _caveats_for_cohort(cohort_size),
    }
