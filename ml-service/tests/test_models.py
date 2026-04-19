"""
Tests for models.py — naive vs. pre-construction dispute prediction.

Run from the `ml-service/` directory:

    pytest tests/test_models.py

Import path & fixtures
----------------------
Same conventions as `tests/test_cleaning.py`:
  - `models` lives at the ml-service package root; `pythonpath = ["."]`
    in pyproject.toml puts it on sys.path.
  - The 15-row gold CSV lives at `<repo>/data/projects.csv`. Tests read
    it relative to this file so they don't depend on pytest's cwd.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from cleaning import REQUIRED_COLUMNS, clean
from models import (
    MINIMUM_TRAINING_SAMPLES,
    PRE_CONSTRUCTION_RAW_FEATURES,
    InsufficientTrainingData,
    train_naive_model,
    train_pre_construction_model,
)


_ML_SERVICE_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_CSV_PATH = _ML_SERVICE_ROOT.parent / "data" / "projects.csv"


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def _minimal_row(**overrides: object) -> dict:
    """Mirror of the test_cleaning helper — every REQUIRED_COLUMN populated.

    Lets us synthesize small DataFrames for edge-case tests without
    duplicating the schema.
    """
    base: dict = {
        "project_id": "PRJ999",
        "project_name": "Test Project",
        "project_type": "Commercial",
        "contract_value_usd": 10_000_000,
        "start_date": "2022-01-01",
        "end_date": "2023-01-01",
        "region": "Northeast",
        "subcontractor_count": 5,
        "delay_days": 10,
        "cost_overrun_pct": 2.0,
        "safety_incidents": 0,
        "payment_disputes": 0,
        "final_status": "Completed",
    }
    base.update(overrides)
    return base


def _df_to_csv_bytes(rows: list[dict]) -> bytes:
    return pd.DataFrame(rows, columns=REQUIRED_COLUMNS).to_csv(index=False).encode()


def _cleaned_sample() -> pd.DataFrame:
    """Load the 15-row assessment CSV through the real cleaning pipeline."""
    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df, _ = clean(raw)
    return df


# Leakage columns — the features that only exist after a project
# completes. Named once at module scope so each assertion references
# the same set.
_LEAKAGE_COLUMNS: set[str] = {
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "actual_duration_days",
}


# ---------------------------------------------------------------------
# 1. train_naive_model returns a well-formed ModelResult
# ---------------------------------------------------------------------


def test_train_naive_model_returns_modelresult_shape() -> None:
    cleaned = _cleaned_sample()
    result = train_naive_model(cleaned)

    # All four contract keys are present.
    assert set(result.keys()) == {
        "accuracy",
        "features_used",
        "feature_importances",
        "n_training_samples",
    }

    # Accuracy is a valid probability.
    assert 0.0 <= result["accuracy"] <= 1.0

    # At least one feature was engineered.
    assert len(result["features_used"]) > 0

    # n_training_samples matches the completed-row count from the fixture.
    expected_completed = int((cleaned["final_status"] == "Completed").sum())
    assert result["n_training_samples"] == expected_completed


# ---------------------------------------------------------------------
# 2. pre_construction model excludes leakage features
# ---------------------------------------------------------------------


def test_pre_construction_model_uses_only_bid_time_features() -> None:
    cleaned = _cleaned_sample()
    result = train_pre_construction_model(cleaned)
    features = set(result["features_used"])

    # None of the post-completion columns may appear, either as a raw
    # numeric column or as a one-hot prefix.
    for leak_col in _LEAKAGE_COLUMNS:
        assert leak_col not in features, (
            f"pre_construction model leaked {leak_col!r} into features_used"
        )
        # Also guard against any hypothetical `<leak>_<value>` prefix —
        # none of these columns are categorical today, but the check
        # future-proofs the test if someone adds one.
        assert not any(f.startswith(f"{leak_col}_") for f in features), (
            f"pre_construction model leaked {leak_col!r}-prefixed dummy column"
        )

    # The two numeric bid-time features must appear as-is.
    assert "contract_value_usd" in features
    assert "subcontractor_count" in features

    # At least one project_type_* and one region_* dummy column must
    # appear (the fixture has multiple values for each).
    assert any(f.startswith("project_type_") for f in features)
    assert any(f.startswith("region_") for f in features)


# ---------------------------------------------------------------------
# 3. naive model DOES include leakage features
# ---------------------------------------------------------------------


def test_naive_model_uses_at_least_one_leakage_feature() -> None:
    """The whole point of the naive model is that it leaks. If this test
    ever fails, the leakage narrative has silently broken.
    """
    cleaned = _cleaned_sample()
    result = train_naive_model(cleaned)
    features = set(result["features_used"])

    assert features & _LEAKAGE_COLUMNS, (
        "naive model has no post-hoc columns; leakage demo is broken"
    )


# ---------------------------------------------------------------------
# 4. naive accuracy >= pre_construction accuracy on the fixture
# ---------------------------------------------------------------------


def test_naive_accuracy_at_least_pre_construction_on_fixture() -> None:
    """The showcase claim: leakage gives the naive model a training-set
    advantage. If we ever see the opposite on the gold fixture, either
    the data changed or something is wrong with one of the models.
    """
    cleaned = _cleaned_sample()
    naive = train_naive_model(cleaned)
    pre = train_pre_construction_model(cleaned)
    assert naive["accuracy"] >= pre["accuracy"]


# ---------------------------------------------------------------------
# 5 & 6. InsufficientTrainingData
# ---------------------------------------------------------------------


def test_insufficient_training_data_raised_on_zero_completed_rows() -> None:
    rows = [
        _minimal_row(project_id="IP1", final_status="In Progress", end_date=""),
        _minimal_row(project_id="IP2", final_status="In Progress", end_date=""),
    ]
    raw = _df_to_csv_bytes(rows)
    cleaned, _ = clean(raw)

    with pytest.raises(InsufficientTrainingData) as exc_info:
        train_naive_model(cleaned)
    assert exc_info.value.n_completed_projects == 0

    with pytest.raises(InsufficientTrainingData) as exc_info:
        train_pre_construction_model(cleaned)
    assert exc_info.value.n_completed_projects == 0


def test_insufficient_training_data_raised_below_minimum() -> None:
    # Four completed rows — one short of MINIMUM_TRAINING_SAMPLES = 5.
    assert MINIMUM_TRAINING_SAMPLES == 5  # guard-rail for this test's premise
    rows = [
        _minimal_row(project_id=f"C{i}", final_status="Completed") for i in range(4)
    ]
    raw = _df_to_csv_bytes(rows)
    cleaned, _ = clean(raw)

    with pytest.raises(InsufficientTrainingData) as exc_info:
        train_naive_model(cleaned)
    assert exc_info.value.n_completed_projects == 4


# ---------------------------------------------------------------------
# 7. feature_importances shape
# ---------------------------------------------------------------------


def test_feature_importances_are_subset_of_features_used_and_non_negative() -> None:
    cleaned = _cleaned_sample()
    for result in (train_naive_model(cleaned), train_pre_construction_model(cleaned)):
        importances = result["feature_importances"]
        features = set(result["features_used"])
        # Keys subset of features_used (could be strictly smaller only
        # in the single-class case, which the gold fixture doesn't hit).
        assert set(importances.keys()).issubset(features)
        # Absolute-value contract: every importance is a non-negative
        # Python float (not numpy.float64).
        for name, value in importances.items():
            assert isinstance(value, float), f"{name} importance is not a float"
            assert value >= 0.0, f"{name} importance is negative: {value}"


# ---------------------------------------------------------------------
# 8. Single-class fallback
# ---------------------------------------------------------------------


def test_single_class_returns_trivial_result() -> None:
    """If every completed row has payment_disputes == 0, the target has
    only one class. sklearn would refuse to fit; we return a trivial
    accuracy=1.0 / empty-importances result instead of crashing.
    """
    # Vary project_type / region / contract_value so get_dummies still
    # produces multiple columns — we want to exercise the encoding path.
    rows = [
        _minimal_row(
            project_id=f"C{i}",
            final_status="Completed",
            payment_disputes=0,
            project_type="Commercial" if i % 2 == 0 else "Residential",
            region="Northeast" if i % 2 == 0 else "South",
            contract_value_usd=1_000_000 * (i + 1),
        )
        for i in range(6)
    ]
    raw = _df_to_csv_bytes(rows)
    cleaned, _ = clean(raw)

    for fn in (train_naive_model, train_pre_construction_model):
        result = fn(cleaned)
        assert result["accuracy"] == 1.0
        assert result["feature_importances"] == {}
        # features_used still reflects the encoded columns — downstream
        # UI code iterates over this list and would break if it were
        # empty.
        assert len(result["features_used"]) > 0
        assert result["n_training_samples"] == 6
