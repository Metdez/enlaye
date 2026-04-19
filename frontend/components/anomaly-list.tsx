// Server-rendered list of flagged projects, each expanded into the specific
// anomaly rules that triggered and the underlying values that caused them.
// WHY: the projects table shows flags as terse pills; analysts asked for a
// second view that spells out *why* each project was flagged. This is the
// "show your work" companion to [projects-table.tsx](./projects-table.tsx).
// See [anomaly-pill.tsx](./anomaly-pill.tsx) for the palette this mirrors.

import type { ReactElement } from "react";
import type { ProjectRow } from "@/lib/types";

// WHY: compact notation keeps contract values narrow ("$12.5M") in the card
// subheader. Instantiated once at module scope to avoid allocating per row.
// Same pattern as [projects-table.tsx](./projects-table.tsx).
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// NOTE: the label half of this map mirrors FLAG_MAP in
// [anomaly-pill.tsx](./anomaly-pill.tsx). Kept local (not imported) to avoid
// editing that file while parallel agents are in flight — if the labels
// diverge, reconcile here and in anomaly-pill.tsx together.
//
// `borderClass` is a literal Tailwind class so the compile-time scanner
// picks it up. Do not construct these via template literals.
// `describe` formats the rule description including the actual row value;
// returns "flagged" as a safe fallback if the underlying value is null.
type FlagMeta = {
  label: string;
  borderClass: string;
  describe: (row: ProjectRow) => string;
};

const FLAG_MAP: Record<string, FlagMeta> = {
  cost_overrun_high: {
    label: "Cost overrun",
    borderClass: "border-l-amber-500",
    describe: (row) =>
      row.cost_overrun_pct === null || row.cost_overrun_pct === undefined
        ? "flagged"
        : `${row.cost_overrun_pct.toFixed(1)}% overrun (threshold \u003E 25%)`,
  },
  delay_days_high: {
    label: "Delay",
    borderClass: "border-l-orange-500",
    describe: (row) =>
      row.delay_days === null || row.delay_days === undefined
        ? "flagged"
        : `${row.delay_days} days delayed (threshold \u003E 150 days)`,
  },
  safety_incidents_high: {
    label: "Safety",
    borderClass: "border-l-red-500",
    describe: (row) =>
      row.safety_incidents === null || row.safety_incidents === undefined
        ? "flagged"
        : `${row.safety_incidents} incidents (threshold \u22655)`,
  },
  payment_disputes_high: {
    label: "Disputes",
    borderClass: "border-l-purple-500",
    describe: (row) =>
      row.payment_disputes === null || row.payment_disputes === undefined
        ? "flagged"
        : `${row.payment_disputes} disputes (threshold \u22655)`,
  },
};

// Neutral gray fallback for unknown flag strings coming from a future
// ML-service revision. Mirrors the failover pattern in AnomalyPill.
const UNKNOWN_BORDER_CLASS = "border-l-zinc-400";

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return currencyFormatter.format(value);
}

function formatHeader(row: ProjectRow): { id: string; name: string } {
  return {
    id: row.project_id_external && row.project_id_external.length > 0
      ? row.project_id_external
      : "—",
    name: row.project_name && row.project_name.length > 0
      ? row.project_name
      : "—",
  };
}

// WHY: the subheader is `type · region · value` — join only the non-null
// pieces so we never render a dangling separator like "Commercial ·  · $12M".
function formatSubheader(row: ProjectRow): string | null {
  const parts: string[] = [];
  if (row.project_type && row.project_type.length > 0) parts.push(row.project_type);
  if (row.region && row.region.length > 0) parts.push(row.region);
  if (
    row.contract_value_usd !== null &&
    row.contract_value_usd !== undefined &&
    !Number.isNaN(row.contract_value_usd)
  ) {
    parts.push(formatCurrency(row.contract_value_usd));
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

export function AnomalyList({
  projects,
}: {
  projects: ProjectRow[];
}): ReactElement {
  // WHY: the DB column defaults to '[]'::jsonb but a projection or legacy
  // row can still surface null. Normalise once so downstream .length / .map
  // calls don't have to guard. Same rationale as AnomalyPillList.
  const flagged = projects
    .map((p, originalIndex) => ({
      project: p,
      flags: p.anomaly_flags ?? [],
      originalIndex,
    }))
    .filter((entry) => entry.flags.length > 0);

  if (flagged.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center text-sm text-zinc-500">
        No anomalies flagged in this portfolio.
      </div>
    );
  }

  // WHY: sort by flag count descending so the worst offenders surface first.
  // Stable tie-break on the original index preserves the upstream ordering
  // (which is the ML service's cleaned-row order).
  const sorted = [...flagged].sort((a, b) => {
    if (b.flags.length !== a.flags.length) {
      return b.flags.length - a.flags.length;
    }
    return a.originalIndex - b.originalIndex;
  });

  return (
    <div className="space-y-3">
      {sorted.map(({ project, flags }) => {
        const header = formatHeader(project);
        const subheader = formatSubheader(project);
        return (
          <div
            key={project.id}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {header.id}
                </span>
                <span className="text-xs text-zinc-400">·</span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {header.name}
                </span>
              </div>
              {subheader !== null && (
                <div className="text-xs text-zinc-500 tabular-nums">
                  {subheader}
                </div>
              )}
            </div>

            <ul className="space-y-1">
              {flags.map((flag) => {
                const meta = FLAG_MAP[flag];
                const label = meta?.label ?? flag;
                const borderClass = meta?.borderClass ?? UNKNOWN_BORDER_CLASS;
                const description = meta ? meta.describe(project) : "flagged";
                return (
                  <li
                    key={flag}
                    className={[
                      "border-l-4 pl-3 py-1 text-sm flex flex-wrap gap-x-2",
                      borderClass,
                    ].join(" ")}
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {label}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400 tabular-nums">
                      {description}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
