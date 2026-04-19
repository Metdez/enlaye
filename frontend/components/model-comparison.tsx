"use client";

// Two-model comparison that visualizes feature leakage to a non-ML reviewer.
// WHY: the whole point of the ML layer is to show that a naive model trained
// on post-hoc features (delay_days, cost_overrun_pct, safety_incidents,
// actual_duration_days) scores higher in training but is undeployable, while
// the pre-construction model — trained only on bid-time features — is the
// honest number. This component makes that contrast physically visible:
// red bars mark leaky features on the left, green-only bars on the right,
// and the copy below spells out why the higher number isn't the better one.
// WHY: client component because Recharts relies on DOM APIs (ResizeObserver,
// SVG measurement). Parent pages fetch ModelRun rows on the server and pass
// them in as plain props.

import { useMemo, type ReactElement } from "react";
import { Sparkles } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModelRun, ModelType } from "@/lib/types";
import { EmptyState as SharedEmptyState } from "./dashboard-shell";

// WHY: the canonical set of post-hoc / leaky feature names. These are numeric
// columns (not one-hot-encoded), so equality against this set is sufficient —
// no prefix matching needed. Sourced from IMPLEMENTATION.md so there's one
// spot to update if the schema grows a new leaky column.
const LEAKY_FEATURE_STEMS = new Set<string>([
  "delay_days",
  "cost_overrun_pct",
  "safety_incidents",
  "actual_duration_days",
]);

// WHY: snake_case feature names are ugly on a y-axis. Map known columns to
// human labels; for OHE features (prefixed `project_type_` / `region_`) strip
// the prefix and show the category with a short label. Fallback is snake-to-
// title-case so new features show up readable even before we add them here.
const KNOWN_LABELS: Record<string, string> = {
  contract_value_usd: "Contract value",
  subcontractor_count: "Subcontractors",
  delay_days: "Delay (days)",
  cost_overrun_pct: "Cost overrun %",
  safety_incidents: "Safety incidents",
  actual_duration_days: "Duration (days)",
};

function formatFeatureName(name: string): string {
  if (name.startsWith("project_type_")) {
    return `Type: ${name.slice("project_type_".length)}`;
  }
  if (name.startsWith("region_")) {
    return `Region: ${name.slice("region_".length)}`;
  }
  const known = KNOWN_LABELS[name];
  if (known) return known;
  // Fallback: snake_case → "Title case" (first word capitalized only).
  const spaced = name.replace(/_/g, " ").trim();
  if (spaced.length === 0) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// WHY: truncate long labels so the y-axis width stays sane. Tooltip still
// shows the full formatted name on hover.
function truncateLabel(label: string, max = 18): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

type ImportanceDatum = {
  feature: string;        // original encoded name (stable key)
  label: string;          // formatted display name
  truncated: string;      // truncated for y-axis
  importance: number;
  leaky: boolean;
};

function buildImportanceData(run: ModelRun): ImportanceDatum[] {
  const importances = run.feature_importances;
  if (!importances) return [];
  const entries = Object.entries(importances);
  if (entries.length === 0) return [];
  const data: ImportanceDatum[] = entries.map(([feature, importance]) => {
    const label = formatFeatureName(feature);
    return {
      feature,
      label,
      truncated: truncateLabel(label),
      importance,
      leaky: LEAKY_FEATURE_STEMS.has(feature),
    };
  });
  // WHY: descending sort so the most important feature sits at the top of
  // the bar chart (Recharts vertical layout reads top-down from the data).
  data.sort((a, b) => b.importance - a.importance);
  return data;
}

// WHY: /train is idempotent, so in practice there should be exactly one run
// per model_type per portfolio. Defensive pick-most-recent covers retries
// or replays without showing the reviewer a stale run.
function pickMostRecent(runs: ModelRun[], type: ModelType): ModelRun | null {
  let best: ModelRun | null = null;
  for (const run of runs) {
    if (run.model_type !== type) continue;
    if (best === null || run.created_at > best.created_at) {
      best = run;
    }
  }
  return best;
}

function formatAccuracy(accuracy: number | null): string {
  if (accuracy === null || Number.isNaN(accuracy)) return "—";
  return `${(accuracy * 100).toFixed(1)}%`;
}

type ChartTooltipPayload = {
  payload?: ImportanceDatum;
  value?: number;
};

function ImportanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ChartTooltipPayload[];
}): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  const datum = first?.payload;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
        {datum.label}
      </p>
      <p className="tabular-nums text-zinc-600 dark:text-zinc-400">
        importance: {datum.importance.toFixed(3)}
      </p>
    </div>
  );
}

function ImportanceChart({
  data,
  variant,
}: {
  data: ImportanceDatum[];
  variant: "naive" | "pre_construction";
}): ReactElement {
  // WHY: row height of 28 keeps labels readable and bars distinct even with
  // ~10 one-hot encoded categorical levels. Floor of 160 stops the chart
  // from collapsing when we only have 2-3 features.
  const height = Math.max(160, data.length * 28);
  // WHY: build a screen-reader summary so the SVG isn't an opaque image.
  // Names the top three features and (for the naive model) calls out leaky
  // ones so the leakage story comes through to assistive tech.
  const top = data.slice(0, 3);
  const topSummary = top
    .map((d) => `${d.label} ${d.importance.toFixed(2)}`)
    .join(", ");
  const leakyCount = data.filter((d) => d.leaky).length;
  const variantNote =
    variant === "naive" && leakyCount > 0
      ? ` ${leakyCount} of these features leak post-hoc information.`
      : "";
  const ariaLabel = `Feature importance bar chart. Top features: ${topSummary}.${variantNote}`;
  return (
    <div style={{ width: "100%", height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <YAxis
            type="category"
            dataKey="truncated"
            width={140}
            tick={{ fontSize: 11 }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
            content={<ImportanceTooltip />}
          />
          <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
            {data.map((datum) => {
              let fill = "#3b82f6"; // blue-500 (naive, non-leaky)
              if (variant === "naive") {
                fill = datum.leaky ? "#ef4444" : "#3b82f6";
              } else {
                fill = "#10b981"; // emerald-500 (pre-construction)
              }
              return <Cell key={datum.feature} fill={fill} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ModelCard({
  run,
  variant,
}: {
  run: ModelRun;
  variant: "naive" | "pre_construction";
}): ReactElement {
  const isNaive = variant === "naive";
  const title = isNaive ? "Naive Model" : "Pre-construction Model";
  const tagline = isNaive
    ? "Uses post-hoc features like delay days and cost overrun — features that only exist after the project is done."
    : "Uses only features available at bid time — the model you could actually run before a project starts.";
  const accuracySubtitle = isNaive
    ? "training accuracy (inflated by leakage)"
    : "training accuracy (honest)";
  const accuracySubtitleClass = isNaive
    ? "text-xs font-medium text-red-600 dark:text-red-400"
    : "text-xs font-medium text-emerald-600 dark:text-emerald-400";
  const accentClass = isNaive
    ? "border-l-4 border-l-red-500"
    : "border-l-4 border-l-emerald-500";

  const data = useMemo(() => buildImportanceData(run), [run]);
  const samples = run.n_training_samples;

  return (
    <div
      className={`rounded-lg border border-zinc-200 p-5 space-y-4 dark:border-zinc-800 ${accentClass}`}
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{tagline}</p>
      </div>

      <div>
        <p className="text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
          {formatAccuracy(run.accuracy)}
        </p>
        <p className={accuracySubtitleClass}>{accuracySubtitle}</p>
      </div>

      <p className="text-xs text-zinc-500">
        Trained on{" "}
        <span className="tabular-nums">
          {samples === null || samples === undefined ? "—" : samples}
        </span>{" "}
        completed projects
      </p>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Feature importances
        </p>
        {data.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Feature importances unavailable (single-class training set).
          </p>
        ) : (
          <ImportanceChart data={data} variant={variant} />
        )}
      </div>
    </div>
  );
}

export function ModelComparison({
  runs,
}: {
  runs: ModelRun[];
}): ReactElement {
  const naive = useMemo(() => pickMostRecent(runs, "naive"), [runs]);
  const pre = useMemo(
    () => pickMostRecent(runs, "pre_construction"),
    [runs],
  );

  if (!runs || runs.length === 0) {
    return (
      <SharedEmptyState
        icon={Sparkles}
        title="No model runs yet"
        description="The naive vs. pre-construction comparison hasn't been built for this portfolio."
        hint="Click Train models above to fit both models."
      />
    );
  }
  // WHY: a partial write (or a mid-air failure on one of the two insert
  // rows) can leave only one model_type in the table. Don't pretend the
  // whole slot is empty — tell the user what we have and nudge them to
  // re-train so the comparison shows up.
  if (naive === null || pre === null) {
    const present = naive !== null ? "naive" : "pre-construction";
    const missing = naive !== null ? "pre-construction" : "naive";
    return (
      <SharedEmptyState
        icon={Sparkles}
        title="Comparison incomplete"
        description={`Only the ${present} model has a recorded run; ${missing} is missing.`}
        hint="Click Train models above to rebuild the comparison."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <ModelCard run={naive} variant="naive" />
        <ModelCard run={pre} variant="pre_construction" />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/30">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Why two models?
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          The left model would look nearly perfect on any test set drawn from
          the same source — but you couldn&apos;t deploy it, because it reads{" "}
          <code className="rounded bg-zinc-200/60 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800/60">
            delay_days
          </code>{" "}
          and{" "}
          <code className="rounded bg-zinc-200/60 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800/60">
            cost_overrun_pct
          </code>
          , numbers that only exist after a project finishes. The right model
          uses only information you&apos;d have at bid time, so its accuracy
          reflects what you&apos;d actually achieve in production. The higher
          number on the left isn&apos;t better — it&apos;s a warning.
        </p>
      </div>
    </div>
  );
}
