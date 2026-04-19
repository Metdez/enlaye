// Server-rendered table of project rows for a single portfolio.
// WHY: no interactivity in Phase 2, so this stays a server component. When
// sort/filter lands in Phase 3 we'll lift it into a client table wrapper.
// See [page.tsx](../app/portfolios/[id]/page.tsx).

import type { ReactElement } from "react";
import { Table2 } from "lucide-react";
import type { ProjectRow } from "@/lib/types";
import { AnomalyPillList } from "./anomaly-pill";
import { EmptyState } from "./dashboard-shell";

// WHY: compact notation keeps the contract_value column narrow ("$45M")
// without sacrificing legibility. Intl.NumberFormat is instantiated once
// per render at module scope to avoid allocating on every row.
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return currencyFormatter.format(value);
}

function formatNumber(value: number | null, suffix = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value}${suffix}`;
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatText(value: string | null): string {
  return value && value.length > 0 ? value : "—";
}

export function ProjectsTable({
  rows,
}: {
  rows: ProjectRow[];
}): ReactElement {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Table2}
        title="No projects in this portfolio"
        description="Upload a CSV from the home page to populate the projects table."
        hint="Once rows are ingested they appear here with anomaly flags."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full text-sm tabular-nums">
        {/* WHY: visually hidden caption gives screen-reader users the table's
            purpose without affecting layout. `sr-only` is a Tailwind helper
            that hides content visually but keeps it in the accessibility tree. */}
        <caption className="sr-only">
          Projects in this portfolio with delay, cost overrun, safety, dispute,
          status, and anomaly flag columns.
        </caption>
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">ID</th>
            <th scope="col" className="px-3 py-2 font-medium">Name</th>
            <th scope="col" className="px-3 py-2 font-medium">Type</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Contract value</th>
            <th scope="col" className="px-3 py-2 font-medium">Region</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Delay (d)</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Cost overrun</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Safety</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Disputes</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Anomalies</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {formatText(r.project_id_external)}
              </td>
              <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                {formatText(r.project_name)}
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {formatText(r.project_type)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatCurrency(r.contract_value_usd)}
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {formatText(r.region)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatNumber(r.delay_days)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatPct(r.cost_overrun_pct)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatNumber(r.safety_incidents)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatNumber(r.payment_disputes)}
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {formatText(r.final_status)}
              </td>
              <td className="px-3 py-2">
                <AnomalyPillList flags={r.anomaly_flags ?? []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
