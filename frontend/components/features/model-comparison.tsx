"use client";

// Naive vs. pre-construction comparison — the showcase feature.
// WHY: the honest accuracy (pre-construction) is the number a user should
// trust; the naive baseline exists only to show how wrong you'd be if
// post-hoc features leaked in. So lead with the honest number, surface the
// gap as a single insight chip, then break down each model's feature
// contributions as a scannable list.
//
// WHY no Recharts here: raw feature importances are abs-coefficients on
// unscaled features and span orders of magnitude (contract_value_usd is in
// millions, subcontractor_count in single digits). On a shared axis the
// small ones collapse to scientific notation (2.8e-8). Normalising each
// model's importances to a share of 1.0 and rendering as native bar rows
// is both readable and honest about what we actually know.

import { useMemo, type ReactElement } from "react";
import { Sparkles, TrendingDown } from "lucide-react";

import { EmptyState } from "@/components/state/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ModelRun, ModelType } from "@/lib/types";

const LEAKY_FEATURE_STEMS = new Set<string>([
  "delay_days",
  "cost_overrun_pct",
  "safety_incidents",
  "actual_duration_days",
]);

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
    return `${name.slice("project_type_".length)} projects`;
  }
  if (name.startsWith("region_")) {
    return `${name.slice("region_".length)} region`;
  }
  const known = KNOWN_LABELS[name];
  if (known) return known;
  const spaced = name.replace(/_/g, " ").trim();
  return spaced.length === 0
    ? name
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type ImportanceRow = {
  feature: string;
  label: string;
  share: number;
  leaky: boolean;
};

function buildRows(run: ModelRun, max = 6): ImportanceRow[] {
  const raw = run.feature_importances;
  if (!raw) return [];
  const entries = Object.entries(raw);
  if (entries.length === 0) return [];

  const total = entries.reduce((acc, [, v]) => acc + Math.max(0, v), 0);
  if (total === 0) return [];

  return entries
    .map(([feature, importance]) => ({
      feature,
      label: formatFeatureName(feature),
      share: Math.max(0, importance) / total,
      leaky: LEAKY_FEATURE_STEMS.has(feature),
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, max);
}

function pickMostRecent(runs: ModelRun[], type: ModelType): ModelRun | null {
  let best: ModelRun | null = null;
  for (const run of runs) {
    if (run.model_type !== type) continue;
    if (best === null || run.created_at > best.created_at) best = run;
  }
  return best;
}

function ImportanceList({
  title,
  subtitle,
  rows,
  tone,
}: {
  title: string;
  subtitle: string;
  rows: ImportanceRow[];
  tone: "honest" | "leaky";
}): ReactElement {
  const accentBar = tone === "honest" ? "bg-primary" : "bg-muted-foreground/60";
  const leakyBar = "bg-destructive";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-h3">{title}</p>
        <p className="text-meta mt-0.5">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-body text-muted-foreground">
          Feature importances unavailable (single-class training set).
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.feature} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-body">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      row.leaky ? leakyBar : accentBar,
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{row.label}</span>
                  {row.leaky ? (
                    <span className="shrink-0 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                      Leaky
                    </span>
                  ) : null}
                </span>
                <span className="text-body tabular-nums text-muted-foreground">
                  {formatPercent(row.share * 100, 0)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 ease-out",
                    row.leaky ? leakyBar : accentBar,
                  )}
                  style={{ width: `${Math.max(2, row.share * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
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

  const naiveRows = useMemo(() => (naive ? buildRows(naive) : []), [naive]);
  const preRows = useMemo(() => (pre ? buildRows(pre) : []), [pre]);

  if (!runs || runs.length === 0 || naive === null || pre === null) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Models not yet trained"
        description="Use the Train models button to fit the naive and pre-construction models."
      />
    );
  }

  const honestPct = pre.accuracy == null ? null : pre.accuracy * 100;
  const naivePct = naive.accuracy == null ? null : naive.accuracy * 100;
  const gap =
    honestPct == null || naivePct == null ? null : naivePct - honestPct;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <p className="text-meta uppercase tracking-wider">
              Honest bid-time accuracy
            </p>
            <p className="mt-2 text-display tabular-nums text-success">
              {honestPct == null ? "—" : formatPercent(honestPct, 1)}
            </p>
            <p className="text-meta mt-3">
              Pre-construction model · {pre.n_training_samples} training
              samples · {formatDate(pre.created_at)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            {gap == null ? null : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                <span className="tabular-nums">
                  −{formatPercent(gap, 1)}
                </span>
                <span className="font-normal opacity-80">leakage gap</span>
              </span>
            )}
            <p className="max-w-xs text-body text-muted-foreground md:text-right">
              A naive baseline reads{" "}
              <span className="font-medium tabular-nums text-foreground">
                {naivePct == null ? "—" : formatPercent(naivePct, 1)}
              </span>
              , but only by reading post-hoc columns that don&apos;t exist
              at bid time.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-10 py-2 md:grid-cols-2 md:gap-12">
          <ImportanceList
            title="Pre-construction model"
            subtitle="Bid-time features only — deployable"
            rows={preRows}
            tone="honest"
          />
          <ImportanceList
            title="Naive model"
            subtitle="Includes post-hoc features — not deployable"
            rows={naiveRows}
            tone="leaky"
          />
        </CardContent>
      </Card>

      <p className="text-meta max-w-3xl">
        Post-hoc features — cost overrun, delays, incidents, duration — only
        exist after a project is complete. A model that reads them at bid
        time is cheating with information it wouldn&apos;t have in
        production.
      </p>
    </div>
  );
}
