"""
Tests for cleaning.py — pure-function data cleaning pipeline.

Run from the `ml-service/` directory:

    pytest

Import path
-----------
`cleaning` lives at the `ml-service/` package root. We rely on the
`pythonpath = ["."]` entry in `pyproject.toml` under
`[tool.pytest.ini_options]` to put that root on sys.path, so tests
just `from cleaning import ...` without any runtime path mangling.

Fixtures
--------
The 15-row sample CSV from the assessment lives at the repo-level
`data/projects.csv`. Rather than duplicating it, these tests read it
relative to this file, so there is exactly one copy of the gold
sample to maintain.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from cleaning import (
    ANOMALY_RULES,
    REQUIRED_COLUMNS,
    clean,
    coerce_types,
    flag_anomalies,
    impute_missing,
    parse_csv,
)


# Path to the assessment's 15-row gold CSV. Relative to this file so
# tests work regardless of pytest's invocation cwd.
_ML_SERVICE_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_CSV_PATH = _ML_SERVICE_ROOT.parent / "data" / "projects.csv"


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def _minimal_row(**overrides: object) -> dict:
    """Return a dict with every REQUIRED_COLUMN populated with a sane default.

    Tests override just the columns they care about.
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


# ---------------------------------------------------------------------
# 1. parse_csv rejects missing columns
# ---------------------------------------------------------------------


def test_parse_csv_rejects_missing_columns() -> None:
    # Drop one required column from every row.
    rows = [_minimal_row()]
    df = pd.DataFrame(rows).drop(columns=["region"])
    raw = df.to_csv(index=False).encode()

    with pytest.raises(ValueError, match="Missing required columns"):
        parse_csv(raw)


# ---------------------------------------------------------------------
# 2. coerce_types produces numeric + datetime dtypes
# ---------------------------------------------------------------------


def test_coerce_types_produces_numeric_and_datetime_dtypes() -> None:
    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df = parse_csv(raw)
    coerced, coercions = coerce_types(df)

    # `contract_value_usd` is all-integer on the 15-row sample, so
    # pandas picks int64 — still numeric, which is what the downstream
    # model cares about. `delay_days` / `cost_overrun_pct` have blanks
    # in the sample and therefore land as float64; assert that too so
    # we know the coercion actually ran.
    assert pd.api.types.is_numeric_dtype(coerced["contract_value_usd"])
    assert pd.api.types.is_float_dtype(coerced["delay_days"])
    assert pd.api.types.is_float_dtype(coerced["cost_overrun_pct"])
    assert pd.api.types.is_datetime64_any_dtype(coerced["start_date"])
    assert pd.api.types.is_datetime64_any_dtype(coerced["end_date"])
    # actual_duration_days is a derived nullable Int64 column.
    assert str(coerced["actual_duration_days"].dtype) == "Int64"

    # Columns whose dtype actually changed should be logged. pandas'
    # CSV reader already parses numeric columns from digits — blank
    # cells in delay_days/cost_overrun_pct/safety_incidents mean the
    # reader lands them at float64 on the way in, so `pd.to_numeric`
    # is a no-op and nothing is logged. Only the two date columns
    # move (object -> datetime64[ns]), plus the derived duration.
    # This is still the behaviour we want: the log is "what actually
    # changed", not "every column we considered".
    columns_logged = {entry["column"] for entry in coercions}
    for col in ("start_date", "end_date", "actual_duration_days"):
        assert col in columns_logged, f"expected coercion logged for {col}"

    # Each coercion entry carries the contract keys.
    for entry in coercions:
        assert set(entry.keys()) == {"column", "from", "to"}


# ---------------------------------------------------------------------
# 3. impute_missing uses median of completed rows only
# ---------------------------------------------------------------------


def test_impute_missing_uses_median_of_completed_only() -> None:
    """Completed rows have delay_days [10, 20, 30]; in-progress rows have
    outliers [1000, 2000].  A fourth completed row has a missing
    delay_days.  The imputed value must be the median of the completed
    group (= 20.0), NOT the grand median that would be dragged upward
    by the two in-progress outliers.
    """
    rows = [
        _minimal_row(project_id="C1", final_status="Completed", delay_days=10),
        _minimal_row(project_id="C2", final_status="Completed", delay_days=20),
        _minimal_row(project_id="C3", final_status="Completed", delay_days=30),
        _minimal_row(project_id="C4", final_status="Completed", delay_days=None),
        _minimal_row(
            project_id="IP1", final_status="In Progress", delay_days=1000, end_date=""
        ),
        _minimal_row(
            project_id="IP2", final_status="In Progress", delay_days=2000, end_date=""
        ),
    ]
    df = pd.DataFrame(rows, columns=REQUIRED_COLUMNS)
    df, _ = coerce_types(df)
    imputed, imputations = impute_missing(df)

    c4_value = imputed.loc[imputed["project_id"] == "C4", "delay_days"].iloc[0]
    # Median of [10, 20, 30] is 20.0. The grand median of
    # [10, 20, 30, 1000, 2000] would be 30 — that is the bug we are
    # specifically guarding against.
    assert c4_value == 20.0

    # In-progress rows must not have been clobbered by the imputer.
    ip_values = set(
        imputed.loc[imputed["project_id"].isin(["IP1", "IP2"]), "delay_days"].tolist()
    )
    assert ip_values == {1000.0, 2000.0}

    # The imputation must be recorded in the report.
    delay_entries = [e for e in imputations if e["column"] == "delay_days"]
    assert len(delay_entries) == 1
    assert delay_entries[0]["n_filled"] == 1
    assert delay_entries[0]["value"] == 20.0


def test_impute_missing_skips_outcome_signals_on_in_progress() -> None:
    """safety_incidents / payment_disputes stay NaN on In-Progress rows.

    Filling these with a completed-median would fabricate outcome
    signals for a still-running project, which is exactly the kind of
    feature leakage the naive-vs-pre-construction split is supposed
    to expose.
    """
    rows = [
        _minimal_row(
            project_id="C1", final_status="Completed", safety_incidents=1, payment_disputes=0
        ),
        _minimal_row(
            project_id="C2", final_status="Completed", safety_incidents=3, payment_disputes=2
        ),
        _minimal_row(
            project_id="IP1",
            final_status="In Progress",
            safety_incidents=None,
            payment_disputes=None,
            end_date="",
        ),
    ]
    df = pd.DataFrame(rows, columns=REQUIRED_COLUMNS)
    df, _ = coerce_types(df)
    imputed, _ = impute_missing(df)

    ip_row = imputed.loc[imputed["project_id"] == "IP1"].iloc[0]
    assert pd.isna(ip_row["safety_incidents"])
    assert pd.isna(ip_row["payment_disputes"])


# ---------------------------------------------------------------------
# 4. flag_anomalies applies all four rules
# ---------------------------------------------------------------------


def test_flag_anomalies_applies_all_four_rules() -> None:
    # One row per rule, plus one clean control row. Values chosen to
    # sit firmly above / below threshold so we are not testing the
    # equality boundary here (that is a separate concern).
    rows = [
        _minimal_row(
            project_id="COST", cost_overrun_pct=ANOMALY_RULES["cost_overrun_pct_high"] + 1
        ),
        _minimal_row(
            project_id="DELAY", delay_days=ANOMALY_RULES["delay_days_high"] + 1
        ),
        _minimal_row(
            project_id="SAFETY",
            safety_incidents=int(ANOMALY_RULES["safety_incidents_high"]),
        ),
        _minimal_row(
            project_id="PAY",
            payment_disputes=int(ANOMALY_RULES["payment_disputes_high"]),
        ),
        _minimal_row(project_id="CLEAN"),  # all defaults well below thresholds
    ]
    df = pd.DataFrame(rows, columns=REQUIRED_COLUMNS)
    df, _ = coerce_types(df)
    flagged = flag_anomalies(df)

    def flags_for(pid: str) -> list[str]:
        return flagged.loc[flagged["project_id"] == pid, "anomaly_flags"].iloc[0]

    assert flags_for("COST") == ["cost_overrun_high"]
    assert flags_for("DELAY") == ["delay_days_high"]
    assert flags_for("SAFETY") == ["safety_incidents_high"]
    assert flags_for("PAY") == ["payment_disputes_high"]
    assert flags_for("CLEAN") == []


def test_flag_anomalies_ignores_nan() -> None:
    rows = [
        _minimal_row(project_id="NAN", cost_overrun_pct=None, delay_days=None),
    ]
    df = pd.DataFrame(rows, columns=REQUIRED_COLUMNS)
    df, _ = coerce_types(df)
    flagged = flag_anomalies(df)
    assert flagged.loc[0, "anomaly_flags"] == []


# ---------------------------------------------------------------------
# 5. end-to-end clean() on the real 15-row sample
# ---------------------------------------------------------------------


def test_clean_e2e_against_sample_csv() -> None:
    with open(SAMPLE_CSV_PATH, "rb") as f:
        raw = f.read()
    df, report = clean(raw)

    # Row count: 15 input rows, no duplicates, no missing project_id,
    # so we expect all 15 preserved.
    assert len(df) == 15
    assert report["rows_rejected"] == 0

    # Schema: column names match the projects-table mapping.
    expected_cols = {
        "project_id_external",
        "project_name",
        "project_type",
        "contract_value_usd",
        "start_date",
        "end_date",
        "region",
        "subcontractor_count",
        "delay_days",
        "cost_overrun_pct",
        "safety_incidents",
        "payment_disputes",
        "final_status",
        "actual_duration_days",
        "anomaly_flags",
    }
    assert set(df.columns) == expected_cols

    # `anomaly_flags` exists and at least one row fires a flag — the
    # 15-row sample is crafted so several projects (e.g. PRJ007,
    # PRJ009) trip at least one threshold.
    assert "anomaly_flags" in df.columns
    assert any(len(flags) > 0 for flags in df["anomaly_flags"])

    # CleaningReport has the expected shape.
    assert set(report.keys()) == {"imputations", "type_coercions", "rows_rejected"}
    assert isinstance(report["imputations"], list)
    assert isinstance(report["type_coercions"], list)
    assert isinstance(report["rows_rejected"], int)

    # On this specific sample, at least one numeric column had blanks
    # that needed imputing (PRJ003 / PRJ013 / PRJ015 all have
    # missing delay_days or cost_overrun_pct).
    assert len(report["imputations"]) > 0


def test_clean_rejects_duplicate_project_ids() -> None:
    rows = [
        _minimal_row(project_id="DUP"),
        _minimal_row(project_id="DUP"),  # duplicate — second copy dropped
        _minimal_row(project_id="UNIQUE"),
    ]
    raw = _df_to_csv_bytes(rows)
    df, report = clean(raw)
    assert len(df) == 2
    assert report["rows_rejected"] == 1
    assert set(df["project_id_external"].tolist()) == {"DUP", "UNIQUE"}


def test_clean_rejects_missing_project_ids() -> None:
    rows = [
        _minimal_row(project_id="OK"),
        _minimal_row(project_id=None),
    ]
    raw = _df_to_csv_bytes(rows)
    df, report = clean(raw)
    assert len(df) == 1
    assert report["rows_rejected"] == 1
