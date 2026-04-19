"""
cleaning.py — pure data-cleaning functions for the CSV ingest path.

Phase 2 · Task A2 — Enlaye Construction Risk Dashboard.

No IO, no network. Takes raw CSV bytes, returns a tidy DataFrame plus a
CleaningReport that describes every transformation applied. The report
is persisted to `portfolios.cleaning_report` (jsonb) by the /ingest
endpoint, so downstream UI can show the user exactly what we did to
their data.

Design notes
------------
- Parsing, type coercion, imputation, and anomaly flagging are
  separate pure functions so tests can pin down each step.
- Column set matches the `projects` table in ARCHITECTURE.md §
  Database Schema. The single rename on the boundary is CSV
  `project_id` → DB `project_id_external` (the DB uses `id` for the
  synthetic UUID primary key).
- Median, not mean, is used for imputation. Construction-project
  datasets have long right tails on delay / cost-overrun / incident
  counts; a mean would get dragged by outliers and silently bias the
  downstream model. See CLAUDE.md § Critical Non-Negotiables #5.
"""

from __future__ import annotations

import io
from typing import TypedDict

import pandas as pd


# ---------------------------------------------------------------------
# Public types + constants
# ---------------------------------------------------------------------


class CleaningReport(TypedDict):
    """Structured record of every transformation `clean()` applied.

    Keys
    ----
    imputations: one entry per column that had NaNs filled.
    type_coercions: one entry per column whose dtype changed.
    rows_rejected: count of rows dropped for bad primary keys.
    """

    imputations: list[dict]
    type_coercions: list[dict]
    rows_rejected: int


REQUIRED_COLUMNS: list[str] = [
    "project_id",
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
]

# WHY: thresholds come straight from the assessment's Task 1c spec. They
# are deliberately hard-coded constants rather than config because the
# "correct" values are part of the deliverable — moving them would
# change the answer. Revisit only if the spec changes.
ANOMALY_RULES: dict[str, float] = {
    "cost_overrun_pct_high": 25.0,  # > 25 %
    "delay_days_high": 150.0,  # > 150 days
    "safety_incidents_high": 5,  # >= 5
    "payment_disputes_high": 5,  # >= 5
}

# Numeric columns that get coerced to a numeric dtype in `coerce_types`
# and imputed from the completed-project median in `impute_missing`.
_NUMERIC_COLUMNS: list[str] = [
    "contract_value_usd",
    "subcontractor_count",
    "delay_days",
    "cost_overrun_pct",
    "safety_incidents",
    "payment_disputes",
]

# WHY: outcome signals that we refuse to impute on still-running
# projects. Filling these with a median for an In-Progress row would
# fabricate a safety/dispute count that the project has not yet earned,
# poisoning any downstream risk model. Completed rows *are* imputed
# because a missing count on a finished project is almost always a data
# entry gap, not a legitimate unknown.
_OUTCOME_SIGNAL_COLUMNS: list[str] = ["safety_incidents", "payment_disputes"]


# ---------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------


def parse_csv(raw: bytes) -> pd.DataFrame:
    """Read CSV bytes into a DataFrame and validate the schema.

    Raises
    ------
    ValueError
        If any of REQUIRED_COLUMNS is missing from the CSV header.
    """
    df = pd.read_csv(io.BytesIO(raw))

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    # Keep only the required columns — ignore any extras the uploader
    # may have tacked on — and preserve their canonical order.
    return df[REQUIRED_COLUMNS].copy()


# ---------------------------------------------------------------------
# Type coercion
# ---------------------------------------------------------------------


def coerce_types(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """Coerce numeric / date columns and compute actual_duration_days.

    Every dtype change is logged to the returned list so the frontend
    can show the user "we parsed these columns as numbers / dates".
    """
    out = df.copy()
    coercions: list[dict] = []

    # WHY: log only columns whose dtype actually moved — no-ops would
    # be noise in the user-facing cleaning report. If pandas' CSV
    # reader already landed a column at the target dtype, `pd.to_numeric`
    # / `pd.to_datetime` is a no-op and we have nothing interesting to
    # tell the user about it.
    for col in _NUMERIC_COLUMNS:
        original_dtype = str(out[col].dtype)
        out[col] = pd.to_numeric(out[col], errors="coerce")
        if original_dtype != str(out[col].dtype):
            coercions.append(
                {"column": col, "from": original_dtype, "to": str(out[col].dtype)}
            )

    for col in ("start_date", "end_date"):
        original_dtype = str(out[col].dtype)
        out[col] = pd.to_datetime(out[col], errors="coerce")
        if original_dtype != str(out[col].dtype):
            coercions.append(
                {"column": col, "from": original_dtype, "to": str(out[col].dtype)}
            )

    # WHY: actual_duration_days is a derived feature the models rely on.
    # Computing it here — where both date columns are freshly parsed —
    # keeps the invariant "if end_date is parseable, duration is set"
    # local to one function. In-progress rows have NaT end_date, so
    # duration is NaT → <NA> in the Int64 output. That's intentional.
    duration = (out["end_date"] - out["start_date"]).dt.days
    # Use the nullable Int64 dtype so NaT propagates as <NA> rather
    # than forcing the column to float (NaN) and later confusing Postgres.
    out["actual_duration_days"] = duration.astype("Int64")
    coercions.append(
        {"column": "actual_duration_days", "from": "derived", "to": "Int64"}
    )

    return out, coercions


# ---------------------------------------------------------------------
# Imputation
# ---------------------------------------------------------------------


def impute_missing(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """Fill numeric NaNs using the MEDIAN of the completed-project subset.

    Completed-only median — not grand median — because In-Progress rows
    have systematically smaller `delay_days` / `cost_overrun_pct` (the
    clock hasn't finished running), so including them would bias the
    imputer downward.

    Outcome signals (`safety_incidents`, `payment_disputes`) are *not*
    imputed on In-Progress rows — see `_OUTCOME_SIGNAL_COLUMNS`.
    """
    # WHY: median not mean because construction-project data has long
    # right tails (airport terminals, wastewater plants). A mean would
    # be pulled up by a few mega-projects and produce imputed values
    # that over-state risk for everyone else. See CLAUDE.md #5.
    out = df.copy()
    imputations: list[dict] = []

    completed_mask = out["final_status"] == "Completed"

    for col in _NUMERIC_COLUMNS:
        completed_values = out.loc[completed_mask, col].dropna()
        if completed_values.empty:
            # No reference population to compute a median from — skip.
            continue
        median_value = float(completed_values.median())

        if col in _OUTCOME_SIGNAL_COLUMNS:
            # Only fill NaNs on completed rows. In-Progress rows stay NaN.
            target_mask = completed_mask & out[col].isna()
        else:
            # Structural columns (contract value, subcontractor count,
            # delay days, cost overrun pct) get filled everywhere —
            # including In-Progress rows — because the model needs a
            # value and a missing structural attribute is a data gap,
            # not a pending outcome.
            target_mask = out[col].isna()

        n_filled = int(target_mask.sum())
        if n_filled == 0:
            continue

        out.loc[target_mask, col] = median_value
        imputations.append(
            {"column": col, "n_filled": n_filled, "value": median_value}
        )

    return out, imputations


# ---------------------------------------------------------------------
# Anomaly flagging
# ---------------------------------------------------------------------


def flag_anomalies(df: pd.DataFrame) -> pd.DataFrame:
    """Add an `anomaly_flags` column: a list[str] per row.

    NaN values never trigger a flag — comparisons against NaN are
    False, which is the behaviour we want.
    """
    out = df.copy()

    # Build per-rule boolean masks. `fillna(False)` after comparison
    # guards against any pandas quirks where NaN bubbles up as <NA>
    # rather than False (e.g. nullable dtypes).
    masks = {
        "cost_overrun_high": (
            out["cost_overrun_pct"] > ANOMALY_RULES["cost_overrun_pct_high"]
        ).fillna(False),
        "delay_days_high": (
            out["delay_days"] > ANOMALY_RULES["delay_days_high"]
        ).fillna(False),
        "safety_incidents_high": (
            out["safety_incidents"] >= ANOMALY_RULES["safety_incidents_high"]
        ).fillna(False),
        "payment_disputes_high": (
            out["payment_disputes"] >= ANOMALY_RULES["payment_disputes_high"]
        ).fillna(False),
    }

    # WHY: build the list column row-wise rather than vectorized because
    # the result is a per-row Python list (jsonb in Postgres). A list
    # comprehension over the mask dict keeps order deterministic and
    # avoids the clumsy "stack masks → groupby" pattern.
    flags_per_row: list[list[str]] = []
    for idx in out.index:
        row_flags = [name for name, mask in masks.items() if bool(mask.at[idx])]
        flags_per_row.append(row_flags)

    out["anomaly_flags"] = flags_per_row
    return out


# ---------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------


def clean(raw: bytes) -> tuple[pd.DataFrame, CleaningReport]:
    """End-to-end: bytes → cleaned DataFrame + CleaningReport.

    Pipeline: parse → reject bad PKs → coerce types → impute → flag.

    The returned DataFrame's columns match the `projects` table in
    ARCHITECTURE.md, with `project_id` renamed to `project_id_external`.
    `rows_rejected` counts rows dropped because `project_id` was
    missing or duplicated.
    """
    df = parse_csv(raw)

    # ---- Reject rows with a bad primary key ----
    # WHY: `project_id` is the external identifier we'll use to dedupe
    # re-uploads and to join back to source-of-truth systems. A row
    # without it, or with a duplicate of another row's id, is
    # unfixable here — drop it and surface the count to the user.
    before = len(df)
    df = df[df["project_id"].notna()]
    df = df.drop_duplicates(subset=["project_id"], keep="first")
    rows_rejected = before - len(df)
    # Re-index so downstream iloc / loc uses a contiguous range.
    df = df.reset_index(drop=True)

    # ---- Transform pipeline ----
    df, coercions = coerce_types(df)
    df, imputations = impute_missing(df)
    df = flag_anomalies(df)

    # ---- Project → DB column names ----
    # NOTE: the DB's `projects.id` is a synthetic UUID set by default;
    # the CSV's `project_id` becomes `project_id_external` so it has an
    # unambiguous home.
    df = df.rename(columns={"project_id": "project_id_external"})

    # Assemble the target column order — mirrors `projects` in
    # ARCHITECTURE.md § Database Schema. `id` and `portfolio_id` are
    # assigned by the /ingest endpoint, not here.
    target_cols = [
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
    ]
    df = df[target_cols]

    report: CleaningReport = {
        "imputations": imputations,
        "type_coercions": coercions,
        "rows_rejected": int(rows_rejected),
    }
    return df, report
