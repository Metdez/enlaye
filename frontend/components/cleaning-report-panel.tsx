"use client";

// Collapsible summary of what the cleaning pipeline did to the raw CSV.
// WHY: reviewers need to see that cleaning is principled (median imputation,
// rejected rows logged) without drowning users on the happy path. Collapsed
// by default so the table remains the visual focus. See
// [page.tsx](../app/portfolios/[id]/page.tsx).

import { useState } from "react";
import type { CleaningReport } from "@/lib/types";

export function CleaningReportPanel({
  report,
  rowCount,
  anomalyCount,
}: {
  report: CleaningReport;
  rowCount: number;
  anomalyCount: number;
}) {
  const [open, setOpen] = useState(false);

  const imputations = report.imputations ?? [];
  const typeCoercions = report.type_coercions ?? [];
  const rowsRejected = report.rows_rejected ?? 0;

  const totalImputed = imputations.reduce((sum, i) => sum + (i.n_filled ?? 0), 0);
  const columnsTouched = imputations.length;

  const summary = `${rowCount} rows loaded · ${totalImputed} values imputed across ${columnsTouched} columns · ${anomalyCount} anomalies flagged · ${rowsRejected} rows rejected`;

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Cleaning report
          </p>
          <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
            {summary}
          </p>
        </div>
        <span
          className="text-xs text-zinc-500"
          aria-hidden="true"
        >
          {open ? "Hide" : "Show"} details
        </span>
      </button>

      {open ? (
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Imputations
              </h3>
              {imputations.length === 0 ? (
                <p className="text-sm text-zinc-500">None.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {imputations.map((i) => (
                    <li
                      key={i.column}
                      className="flex items-start justify-between gap-2"
                    >
                      <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        {i.column}
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        {i.value} used ({i.n_filled} filled)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Type coercions
              </h3>
              {typeCoercions.length === 0 ? (
                <p className="text-sm text-zinc-500">None.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {typeCoercions.map((c) => (
                    <li
                      key={c.column}
                      className="flex items-start justify-between gap-2"
                    >
                      <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        {c.column}
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        {c.from} → {c.to}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Rejected rows
              </h3>
              <p className="text-sm text-zinc-900 dark:text-zinc-100">
                {rowsRejected === 0
                  ? "All rows passed validation."
                  : `${rowsRejected} row${rowsRejected === 1 ? "" : "s"} failed validation and were not ingested.`}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
