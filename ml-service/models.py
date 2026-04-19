"""
models.py — naive vs. pre-construction dispute-prediction models.

Phase 3 · Enlaye Construction Risk Dashboard.

The showcase narrative
----------------------
This module trains TWO logistic-regression classifiers on the same
cleaned-projects DataFrame, predicting the binary outcome
`payment_disputes >= 1`:

1. **Naive model** — uses every numeric + encoded categorical feature we
   have, including post-hoc leakage signals like `delay_days`,
   `cost_overrun_pct`, `safety_incidents`, and `actual_duration_days`.
   These columns only get their real values after a project is
   complete, so in production (where we want to score *in-progress* or
   *prospective* projects at bid time) they do not exist yet. Training
   accuracy looks great; real-world accuracy is zero.

2. **Pre-construction model** — uses ONLY features available at bid time:
   `project_type`, `region`, `contract_value_usd`, `subcontractor_count`.
   Lower training accuracy, but the only model a risk analyst can
   actually deploy.

The `/train` endpoint runs both and surfaces the gap in the UI. THAT is
the product: we prove to the user, with their own data, that one of the
two models is academically impressive and operationally useless.

Design notes
------------
- No train/test split, no cross-validation. The assessment ships with
  ~9 completed rows; CV on that sample size is statistical theater.
  We report training accuracy and flag that clearly in the UI.
- `pandas.get_dummies(drop_first=False)` — we keep every category as
  its own column so the UI can show a feature-importance bar per
  category. `drop_first=True` would hide one level per categorical
  column and break the "importance per region / per project type"
  story the bar chart tells.
- Feature importances are the ABSOLUTE values of the logistic-regression
  coefficients. Signed coefficients would be more informative (you'd
  know direction), but the public ModelResult contract is
  `dict[str, float]` and the UI sorts by magnitude — absolute matches
  both the contract and the visualization.
- Zero IO. Zero network. Zero DB. Pure functions on a DataFrame.
"""

from __future__ import annotations

from typing import TypedDict

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score


# ---------------------------------------------------------------------
# Public types + constants
# ---------------------------------------------------------------------


class ModelResult(TypedDict):
    """Return shape for both `train_naive_model` and `train_pre_construction_model`.

    Keys
    ----
    accuracy: training accuracy on the completed-rows subset, in [0, 1].
    features_used: human-readable feature names after one-hot encoding
        (e.g. ``"project_type_Commercial"``, ``"contract_value_usd"``).
    feature_importances: mapping of feature name -> absolute coefficient.
        Empty dict when the training set has a single class.
    n_training_samples: count of completed rows that actually reached
        `fit()` (after any defensive NaN drop).
    """

    accuracy: float
    features_used: list[str]
    feature_importances: dict[str, float]
    n_training_samples: int


# WHY: five is the smallest sample size at which a logistic regression
# coefficient is anything other than numerical noise. Below that, we
# fail loudly rather than return a confident-looking score. The /train
# endpoint converts this into a 400 with a user-friendly message.
MINIMUM_TRAINING_SAMPLES: int = 5


# Public feature list for the pre_construction model — single source of
# truth. Named at module scope so `/train` and tests can import it and
# assert against it, instead of duplicating the list in three places.
PRE_CONSTRUCTION_RAW_FEATURES: list[str] = [
    "project_type",
    "region",
    "contract_value_usd",
    "subcontractor_count",
]


# All features the naive model consumes, BEFORE one-hot encoding.
# WHY: the leaky columns (`delay_days`, `cost_overrun_pct`,
# `safety_incidents`, `actual_duration_days`) are here on purpose. They
# are the reason the naive model exists — to demonstrate what happens
# when an analyst trains on post-hoc signals without realising it.
_NAIVE_RAW_FEATURES: list[str] = [
    "project_type",
    "region",
    "contract_value_usd",
    "subcontractor_count",
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "actual_duration_days",
]


# Columns that get one-hot encoded in either model.
_CATEGORICAL_FEATURES: set[str] = {"project_type", "region"}


class InsufficientTrainingData(Exception):
    """Raised when there are fewer than MINIMUM_TRAINING_SAMPLES completed rows.

    Carries the actual count so the /train endpoint can surface it in
    the 400 response body — "only 3 completed projects, need 5" is a
    more actionable error than "insufficient data".
    """

    def __init__(self, n_completed_projects: int) -> None:
        super().__init__(
            f"Only {n_completed_projects} completed projects; need {MINIMUM_TRAINING_SAMPLES}."
        )
        self.n_completed_projects = n_completed_projects


# ---------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------


def _completed_subset(cleaned_df: pd.DataFrame) -> pd.DataFrame:
    """Return the completed-rows slice, or raise if it's too small.

    The target variable (`payment_disputes`) is only trustworthy on
    completed projects — the cleaning pipeline deliberately refuses to
    impute it on in-progress rows (see cleaning._OUTCOME_SIGNAL_COLUMNS).
    Training on in-progress rows would mean training on NaN targets.
    """
    if cleaned_df.empty:
        raise InsufficientTrainingData(0)

    completed = cleaned_df[cleaned_df["final_status"] == "Completed"].copy()
    n = len(completed)
    if n < MINIMUM_TRAINING_SAMPLES:
        raise InsufficientTrainingData(n)
    return completed


def _encode_features(df: pd.DataFrame, raw_features: list[str]) -> pd.DataFrame:
    """One-hot encode categoricals, keep numerics as-is.

    Column naming: `project_type_<value>`, `region_<value>`. Uses
    `drop_first=False` so every category gets its own column — the UI
    renders one importance bar per category, and dropping a level would
    silently hide one of them.
    """
    categorical_cols = [c for c in raw_features if c in _CATEGORICAL_FEATURES]
    numeric_cols = [c for c in raw_features if c not in _CATEGORICAL_FEATURES]

    encoded_parts: list[pd.DataFrame] = []
    if numeric_cols:
        encoded_parts.append(df[numeric_cols].copy())
    if categorical_cols:
        # `get_dummies` defaults: prefix = column name, separator = "_",
        # which gives us the `project_type_Commercial` shape the spec
        # requires.
        dummies = pd.get_dummies(
            df[categorical_cols],
            columns=categorical_cols,
            drop_first=False,
            dtype=float,
        )
        encoded_parts.append(dummies)

    return pd.concat(encoded_parts, axis=1) if encoded_parts else pd.DataFrame(index=df.index)


def _train(
    cleaned_df: pd.DataFrame,
    raw_features: list[str],
) -> ModelResult:
    """Shared fit-and-score routine for both public models.

    Steps: filter to completed rows → drop rows with NaNs in the feature
    set (defensive; cleaning should already have handled this on
    completed rows) → one-hot encode → fit LogisticRegression → report.
    """
    completed = _completed_subset(cleaned_df)

    # Defensive: the cleaning pipeline imputes structural columns on all
    # rows and outcome signals on completed rows, so by the time we're
    # here there should be no NaNs. But if a future cleaning change
    # breaks that invariant we'd rather drop the row than pass NaN to
    # sklearn (which would crash with an opaque error).
    feature_frame = completed.dropna(subset=raw_features)
    if len(feature_frame) < MINIMUM_TRAINING_SAMPLES:
        raise InsufficientTrainingData(len(feature_frame))

    X = _encode_features(feature_frame, raw_features)
    features_used: list[str] = list(X.columns)

    # WHY: binary target. We care about "did this project hit at least
    # one payment dispute", not the raw count — the count distribution
    # is too skewed on a 15-row demo to fit as a regression.
    y = (feature_frame["payment_disputes"] >= 1).astype(int)

    n_training_samples = int(len(feature_frame))

    # Single-class edge case: sklearn's LogisticRegression refuses to
    # fit when y has only one unique value. Rather than crash, return a
    # trivially-correct result. This matches the contract the /train
    # endpoint expects and keeps the UI out of an error state on
    # pathological uploads.
    if y.nunique() < 2:
        return ModelResult(
            accuracy=1.0,
            features_used=features_used,
            feature_importances={},
            n_training_samples=n_training_samples,
        )

    # max_iter=1000 because the LBFGS default (100) sometimes fails to
    # converge on tiny, unscaled construction feature sets (contract
    # values in the millions alongside subcontractor counts in single
    # digits). random_state fixes coefficient signs across reruns so
    # the feature-importance bars are stable between refreshes.
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X, y)

    y_pred = model.predict(X)
    accuracy = float(accuracy_score(y, y_pred))

    # model.coef_ is shape (1, n_features) for binary classification.
    # WHY abs(): the public contract is dict[str, float] and the UI
    # sorts importances by magnitude; absolute matches both the type
    # and the visualization. Signed coefficients would be richer but
    # would require a contract change.
    coefs = model.coef_[0]
    feature_importances: dict[str, float] = {
        name: float(abs(coef)) for name, coef in zip(features_used, coefs)
    }

    return ModelResult(
        accuracy=accuracy,
        features_used=features_used,
        feature_importances=feature_importances,
        n_training_samples=n_training_samples,
    )


# ---------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------


def train_naive_model(cleaned_df: pd.DataFrame) -> ModelResult:
    """Train the leaky baseline model on all available features.

    Features include `delay_days`, `cost_overrun_pct`,
    `safety_incidents`, `actual_duration_days` — all of which are only
    populated after a project completes. Training accuracy will look
    strong; the model would be useless at bid time because these
    columns would all be missing. That contrast is the whole point of
    the feature — see module docstring.
    """
    return _train(cleaned_df, _NAIVE_RAW_FEATURES)


def train_pre_construction_model(cleaned_df: pd.DataFrame) -> ModelResult:
    """Train the honest model using only bid-time-available features.

    Uses only the raw columns listed in `PRE_CONSTRUCTION_RAW_FEATURES`.
    Lower training accuracy than the naive model, but the only model a
    risk analyst can actually deploy on a new project.
    """
    return _train(cleaned_df, PRE_CONSTRUCTION_RAW_FEATURES)
