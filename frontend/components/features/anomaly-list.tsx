"use client";

// Grouped anomaly view: switch between by-project and by-category via Tabs.
// WHY: client component because the grouping toggle is interactive state.
// Each view rebuilds from the same input array — cheap enough to recompute
// inline with useMemo rather than prop-drilling two shapes in.

import { useMemo, type ReactElement } from "react";
import { CheckCircle2 } from "lucide-react";

import {
  AnomalyBadge,
  type AnomalyCategory,
} from "@/components/data/anomaly-badge";
import { RiskDial } from "@/components/data/risk-dial";
import { TabularNumber } from "@/components/data/tabular-number";
import { EmptyState } from "@/components/state/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
// NOTE: CardHeader/CardTitle are still used by the "by category" tab below.
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { ProjectRow } from "@/lib/types";

// WHY: single source for flag → category + human description. Keeps the
// per-view presentation dumb. Unknown flags are dropped — we don't render
// "flagged" placeholders in a design that's supposed to feel precise.
type FlagMeta = {
  category: AnomalyCategory;
  describe: (row: ProjectRow) => string;
};

const FLAG_META: Record<string, FlagMeta> = {
  cost_overrun_high: {
    category: "cost_overrun",
    describe: (row) =>
      row.cost_overrun_pct == null
        ? "Overrun exceeds 25% threshold"
        : `Overrun ${formatPercent(row.cost_overrun_pct)} exceeds 25% threshold`,
  },
  delay_days_high: {
    category: "schedule_delay",
    describe: (row) =>
      row.delay_days == null
        ? "Delay exceeds 150 day threshold"
        : `Delay ${row.delay_days} days exceeds 150 day threshold`,
  },
  safety_incidents_high: {
    category: "safety",
    describe: (row) =>
      row.safety_incidents == null
        ? "5 or more safety incidents"
        : `${row.safety_incidents} safety incidents (threshold ≥ 5)`,
  },
  payment_disputes_high: {
    category: "disputes",
    describe: (row) =>
      row.payment_disputes == null
        ? "5 or more payment disputes"
        : `${row.payment_disputes} payment disputes (threshold ≥ 5)`,
  },
};

const CATEGORY_ORDER: AnomalyCategory[] = [
  "cost_overrun",
  "schedule_delay",
  "safety",
  "disputes",
];

const CATEGORY_LABEL: Record<AnomalyCategory, string> = {
  cost_overrun: "Cost overrun",
  schedule_delay: "Schedule delay",
  safety: "Safety",
  disputes: "Disputes",
};

type FlaggedEntry = {
  project: ProjectRow;
  flags: { raw: string; meta: FlagMeta }[];
};

function collectFlagged(
  projects: ProjectRow[],
  scoreByProjectId?: Map<string, number>,
): FlaggedEntry[] {
  const out: FlaggedEntry[] = [];
  for (const p of projects) {
    const resolved = (p.anomaly_flags ?? [])
      .map((raw) => {
        const meta = FLAG_META[raw];
        return meta ? { raw, meta } : null;
      })
      .filter((x): x is { raw: string; meta: FlagMeta } => x !== null);
    if (resolved.length > 0) out.push({ project: p, flags: resolved });
  }
  // WHY: when scores are available, sort by risk desc so the page leads with
  // the hottest projects. Fall back to flag-count ordering (the legacy
  // behavior) so this file still works without a score map.
  if (scoreByProjectId && scoreByProjectId.size > 0) {
    out.sort((a, b) => {
      const sa = scoreByProjectId.get(a.project.id);
      const sb = scoreByProjectId.get(b.project.id);
      if (sa == null && sb == null) return b.flags.length - a.flags.length;
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sb - sa;
    });
  } else {
    out.sort((a, b) => b.flags.length - a.flags.length);
  }
  return out;
}

function projectHeader(row: ProjectRow): string {
  const id = row.project_id_external ?? "—";
  const name = row.project_name ?? "—";
  return `${id} · ${name}`;
}

function projectSubheader(row: ProjectRow): string | null {
  const parts: string[] = [];
  if (row.project_type) parts.push(row.project_type);
  if (row.region) parts.push(row.region);
  if (row.contract_value_usd != null) {
    parts.push(formatCurrency(row.contract_value_usd));
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

export function AnomalyList({
  projects,
  scoreByProjectId,
}: {
  projects: ProjectRow[];
  // WHY: optional so existing callers don't break; when present each row
  // prepends a small RiskDial to anchor the anomaly in its risk context.
  scoreByProjectId?: Map<string, number>;
}): ReactElement {
  const flagged = useMemo(
    () => collectFlagged(projects, scoreByProjectId),
    [projects, scoreByProjectId],
  );

  // Group by category for the alternate view. Using the resolved entries
  // means unknown flag strings were already dropped — no "misc" bucket.
  const byCategory = useMemo(() => {
    const map = new Map<AnomalyCategory, ProjectRow[]>();
    for (const entry of flagged) {
      for (const { meta } of entry.flags) {
        const existing = map.get(meta.category);
        if (existing) {
          // Avoid duplicates if a project has two flags in the same category
          if (!existing.some((p) => p.id === entry.project.id)) {
            existing.push(entry.project);
          }
        } else {
          map.set(meta.category, [entry.project]);
        }
      }
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      projects: map.get(cat) ?? [],
    }));
  }, [flagged]);

  if (flagged.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No anomalies flagged"
        description="Every project in this portfolio passed the threshold checks."
      />
    );
  }

  return (
    <Tabs defaultValue="by-project" className="gap-4">
      <TabsList>
        <TabsTrigger value="by-project">By project</TabsTrigger>
        <TabsTrigger value="by-category">By category</TabsTrigger>
      </TabsList>

      <TabsContent value="by-project">
        <ul className="space-y-3 list-none p-0" aria-label="Flagged projects">
          {flagged.map(({ project, flags }) => {
            const sub = projectSubheader(project);
            const score = scoreByProjectId?.get(project.id);
            return (
              <li key={project.id}>
                <Card size="sm">
                  <CardContent className="flex items-start gap-3">
                    {/* WHY: left-side dial anchors each anomaly to its risk
                        band so a reader scanning the column gets a color
                        read before reading the flag copy. */}
                    {score != null ? (
                      <div className="shrink-0 pt-0.5">
                        <RiskDial score={score} size="sm" />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="font-mono text-body text-foreground">
                          {projectHeader(project)}
                        </p>
                        {sub ? (
                          <p className="text-meta tabular-nums">{sub}</p>
                        ) : null}
                      </div>
                      {flags.map(({ raw, meta }) => (
                        <div
                          key={raw}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <AnomalyBadge category={meta.category} />
                          <span className="text-meta tabular-nums">
                            {meta.describe(project)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      </TabsContent>

      <TabsContent value="by-category">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {byCategory.map(({ category, projects: projs }) => (
            <Card key={category} size="sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <AnomalyBadge category={category} />
                  <TabularNumber value={projs.length} />
                </div>
              </CardHeader>
              <CardContent>
                {projs.length === 0 ? (
                  <p className="text-meta">
                    No {CATEGORY_LABEL[category].toLowerCase()} flags.
                  </p>
                ) : (
                  <ul className="space-y-1 text-body">
                    {projs.map((p) => (
                      <li
                        key={p.id}
                        className="truncate text-muted-foreground"
                        title={projectHeader(p)}
                      >
                        {p.project_name ?? p.project_id_external ?? "—"}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
