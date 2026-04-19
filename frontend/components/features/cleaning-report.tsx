"use client";

// Collapsible cleaning report panel.
// WHY: reviewers need to see that cleaning is principled (median imputation,
// rejected rows logged) without drowning users on the happy path. Collapsed
// by default so the table remains the visual focus.

import { useId, useState, type ReactElement } from "react";
import { ChevronDown } from "lucide-react";

import { TabularNumber } from "@/components/data/tabular-number";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CleaningReport as CleaningReportData } from "@/lib/types";

export function CleaningReport({
  report,
  rowCount,
  anomalyCount,
}: {
  report: CleaningReportData;
  rowCount: number;
  anomalyCount: number;
}): ReactElement {
  const [open, setOpen] = useState(false);
  // WHY: stable id pair so aria-controls references the same panel across
  // renders. useId() is SSR-safe.
  const panelId = useId();

  const imputations = report.imputations ?? [];
  const typeCoercions = report.type_coercions ?? [];
  const rowsRejected = report.rows_rejected ?? 0;

  return (
    <Card size="sm" aria-label="Cleaning report" className="p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0 flex-1">
          <p className="text-meta uppercase tracking-wide">Cleaning report</p>
          <p className="mt-0.5 text-body text-foreground">
            <TabularNumber value={rowCount} /> rows ·{" "}
            <TabularNumber value={anomalyCount} /> anomalies ·{" "}
            <TabularNumber value={rowsRejected} /> rejected
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={panelId}
          className="grid gap-6 border-t border-border px-4 py-4 md:grid-cols-3"
        >
          <div>
            <h3 className="text-meta uppercase tracking-wide">Imputations</h3>
            {imputations.length === 0 ? (
              <p className="mt-2 text-body text-muted-foreground">None.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {imputations.map((i) => (
                  <li
                    key={i.column}
                    className="flex items-center justify-between gap-2 text-body"
                  >
                    <span className="font-mono text-meta text-foreground">
                      {i.column}
                    </span>
                    <span className="text-meta tabular-nums">
                      {i.value} · <TabularNumber value={i.n_filled} /> filled
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-meta uppercase tracking-wide">Type coercions</h3>
            {typeCoercions.length === 0 ? (
              <p className="mt-2 text-body text-muted-foreground">None.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {typeCoercions.map((c) => (
                  <li
                    key={c.column}
                    className="flex items-center justify-between gap-2 text-body"
                  >
                    <span className="font-mono text-meta text-foreground">
                      {c.column}
                    </span>
                    <span className="text-meta">
                      {c.from} → {c.to}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-meta uppercase tracking-wide">Rejected rows</h3>
            <p className="mt-2 text-body text-foreground">
              {rowsRejected === 0
                ? "All rows passed validation."
                : `${rowsRejected} row${rowsRejected === 1 ? "" : "s"} failed validation.`}
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
