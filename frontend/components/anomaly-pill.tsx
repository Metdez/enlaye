// Tiny, pure presentational pill used in the projects table.
// WHY: anomaly flag strings are the contract with the ML service. Centralise
// the flag-name → (label, color) mapping here so the table stays dumb and any
// new flag is a one-line edit. See [projects-table.tsx](./projects-table.tsx).

import type { ReactElement } from "react";

type FlagMeta = {
  label: string;
  // WHY: `description` is the screen-reader-friendly explanation of what
  // the flag means. Visual users get the short label + color; assistive-tech
  // users get the full sentence via aria-label. Keep these in sync with
  // the thresholds documented in [anomaly-list.tsx](./anomaly-list.tsx).
  description: string;
  className: string;
};

// NOTE: Tailwind 4 — these are literal class names so the compiler can see
// them. Do not construct them via template literals.
// WHY: light-mode color choices use 900-weight text on 100-weight backgrounds,
// dark-mode uses 100 on 900/40 — both pass WCAG AA contrast (≥4.5:1) for the
// xs body text size used here.
const FLAG_MAP: Record<string, FlagMeta> = {
  cost_overrun_high: {
    label: "Cost overrun",
    description: "Cost overrun above 25% threshold",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  },
  delay_days_high: {
    label: "Delay",
    description: "Delay above 150 days threshold",
    className: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  },
  safety_incidents_high: {
    label: "Safety",
    description: "Five or more safety incidents",
    className: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  },
  payment_disputes_high: {
    label: "Disputes",
    description: "Five or more payment disputes",
    className: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  },
};

const UNKNOWN_CLASS =
  "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";

export function AnomalyPill({ flag }: { flag: string }): ReactElement {
  const meta = FLAG_MAP[flag];
  const label = meta?.label ?? flag;
  const className = meta?.className ?? UNKNOWN_CLASS;
  const ariaLabel = meta ? `Anomaly: ${meta.description}` : `Anomaly: ${flag}`;
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      ].join(" ")}
      title={flag}
      aria-label={ariaLabel}
    >
      {label}
    </span>
  );
}

// WHY: the DB column defaults to '[]'::jsonb, but a row inserted before
// the default was in place (or a projection that omits the column) can
// legitimately arrive as null. Type the input to match reality so callers
// stop passing `r.anomaly_flags ?? []` defensively.
export function AnomalyPillList({
  flags,
}: {
  flags: string[] | null | undefined;
}): ReactElement {
  if (!flags || flags.length === 0) {
    return (
      <span className="text-xs text-zinc-400" aria-label="No anomalies">
        —
      </span>
    );
  }
  return (
    <div
      className="flex flex-wrap gap-1"
      role="list"
      aria-label={`${flags.length} anomaly flag${flags.length === 1 ? "" : "s"}`}
    >
      {flags.map((f) => (
        <AnomalyPill key={f} flag={f} />
      ))}
    </div>
  );
}
