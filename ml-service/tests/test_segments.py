"""
Tests for segments.py — size bucketing, normalized delay, clustering.

Run from the `ml-service/` directory:

    pytest tests/test_segments.py
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from cleaning import clean
from segments import (
    assign_clusters,
    compute_segments_df,
    normalized_delay,
    size_bucket,
)


_ML_SERVICE_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_CSV_PATH = _ML_SERVICE_ROOT.parent / "data" / "projects.csv"


def _cleaned_sample() -> pd.DataFrame:
    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df, _ = clean(raw)
    # Synthesize an `id` column so compute_segments_df sees the shape it
    # expects (in production this comes from Postgres).
    df = df.copy()
    df["id"] = [f"uuid-{i}" for i in range(len(df))]
    return df


# ---------------------------------------------------------------------
# size_bucket
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        (0, "small"),
        (24_999_999, "small"),
        (25_000_000, "medium"),
        (74_999_999, "medium"),
        (75_000_000, "large"),
        (100_000_000, "large"),
        (None, "small"),
        (float("nan"), "small"),
    ],
)
def test_size_bucket_boundaries(value, expected) -> None:
    assert size_bucket(value) == expected


# ---------------------------------------------------------------------
# normalized_delay
# ---------------------------------------------------------------------


def test_normalized_delay_basic() -> None:
    # 30 / (365 + 1) = 0.0819...
    result = normalized_delay(30, 365)
    assert result is not None
    assert math.isclose(result, 30 / 366)


def test_normalized_delay_zero_duration() -> None:
    # Zero duration still returns a value (denominator is duration+1).
    result = normalized_delay(5, 0)
    assert result == 5.0


@pytest.mark.parametrize(
    "delay, duration",
    [
        (None, 100),
        (10, None),
        (None, None),
        (float("nan"), 100),
        (10, float("nan")),
    ],
)
def test_normalized_delay_missing_inputs_return_none(delay, duration) -> None:
    assert normalized_delay(delay, duration) is None


# ---------------------------------------------------------------------
# assign_clusters
# ---------------------------------------------------------------------


def _synthetic_cluster_frame(n: int) -> pd.DataFrame:
    """Build a minimal frame that has the columns assign_clusters needs."""
    rng = np.random.default_rng(seed=0)
    return pd.DataFrame(
        {
            "project_type": rng.choice(["Infrastructure", "Commercial"], size=n),
            "region": rng.choice(["Northeast", "Southeast"], size=n),
            "contract_value_usd": rng.integers(10_000_000, 100_000_000, size=n).astype(float),
            "subcontractor_count": rng.integers(1, 25, size=n),
        }
    )


def test_assign_clusters_small_n_returns_zeros() -> None:
    # n<4 → no meaningful clustering possible → all zeros.
    df = _synthetic_cluster_frame(3)
    labels = assign_clusters(df, k=3)
    assert len(labels) == 3
    assert (labels == 0).all()


def test_assign_clusters_clamps_k_when_n_small() -> None:
    # With n=5 and k=10, effective_k should be clamp(max(2, min(10, 5//3))) = 2.
    df = _synthetic_cluster_frame(5)
    labels = assign_clusters(df, k=10)
    assert len(labels) == 5
    assert labels.nunique() <= 2


def test_assign_clusters_length_matches_input() -> None:
    df = _synthetic_cluster_frame(12)
    labels = assign_clusters(df, k=3)
    assert len(labels) == 12
    # Every label should be a non-negative int less than effective_k (<=3).
    assert labels.min() >= 0
    assert labels.max() <= 2


def test_assign_clusters_handles_nan_contract_value() -> None:
    df = _synthetic_cluster_frame(6)
    df.loc[0, "contract_value_usd"] = np.nan
    labels = assign_clusters(df, k=2)
    # Must not raise, must return a label for every row.
    assert len(labels) == 6


# ---------------------------------------------------------------------
# compute_segments_df — end-to-end against the demo CSV
# ---------------------------------------------------------------------


def test_compute_segments_df_demo_shape() -> None:
    cleaned = _cleaned_sample()
    segments = compute_segments_df(cleaned)

    assert list(segments.columns) == [
        "project_id",
        "size_bucket",
        "normalized_delay",
        "cluster_id",
    ]
    assert len(segments) == len(cleaned)

    # Every size_bucket must be one of the check-constraint values.
    assert set(segments["size_bucket"].unique()).issubset({"small", "medium", "large"})

    # In-progress rows (delay or duration NaN) should have None normalized_delay.
    in_progress_ids = cleaned[cleaned["final_status"] != "Completed"]["id"].tolist()
    for pid in in_progress_ids:
        row = segments.loc[segments["project_id"] == pid].iloc[0]
        # actual_duration_days is NaT/NA for in-progress rows; normalized_delay
        # should bail out to None for them.
        assert row["normalized_delay"] is None or pd.isna(row["normalized_delay"])


def test_compute_segments_df_empty() -> None:
    empty = pd.DataFrame(
        columns=[
            "id",
            "contract_value_usd",
            "delay_days",
            "actual_duration_days",
            "project_type",
            "region",
            "subcontractor_count",
        ]
    )
    result = compute_segments_df(empty)
    assert result.empty
    assert list(result.columns) == [
        "project_id",
        "size_bucket",
        "normalized_delay",
        "cluster_id",
    ]
