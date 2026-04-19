// Monitor — live watchlist of in-progress projects with their risk scores.
// WHY: server component for the data fetch + table render; the per-row
// watchlist toggle is a client island (localStorage-backed). Risk dial
// reuses the existing primitive at size="sm" so the row hairline stays
// tight.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { Radar } from "lucide-react";

import { AnomalyBadge, type AnomalyCategory } from "@/components/data/anomaly-badge";
import { RiskDial } from "@/components/data/risk-dial";
import { WatchlistToggle } from "@/components/features/watchlist-toggle";
import { EmptyState } from "@/components/state/empty-state";
import { SectionHeader } from "@/components/state/section-header";
import { formatCurrency, formatNumber } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import type { ProjectRow, RiskScore } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const FLAG_TO_CATEGORY: Record<string, AnomalyCategory> = {
  cost_overrun_high: "cost_overrun",
  delay_days_high: "schedule_delay",
  safety_incidents_high: "safety",
  payment_disputes_high: "disputes",
};

export default async function MonitorPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, projectsRes, risksRes] = await Promise.all([
    supabase.from("portfolios").select("id, name").eq("id", id).maybeSingle(),
    // WHY: order by uploaded_at is not in our schema — fall back to
    // project_id_external so the order is stable across reloads.
    supabase
      .from("projects")
      .select(
        "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
      )
      .eq("portfolio_id", id)
      .eq("final_status", "In Progress")
      .order("project_id_external", { ascending: true }),
    supabase
      .from("risk_scores")
      .select("id, project_id, portfolio_id, score, breakdown, computed_at")
      .eq("portfolio_id", id),
  ]);

  if (projectsRes.error) {
    throw new Error(`Failed to load projects: ${projectsRes.error.message}`);
  }
  if (risksRes.error) {
    console.warn("risk_scores fetch failed:", risksRes.error.message);
  }
  if (!portfolioRes.data) notFound();

  const inProgress = (projectsRes.data ?? []) as ProjectRow[];
  const risks = (risksRes.data ?? []) as RiskScore[];

  const scoreByProjectId = new Map<string, number>();
  for (const r of risks) scoreByProjectId.set(r.project_id, r.score);

  // Sort by risk desc so the page leads with the hottest in-progress
  // projects. Rows without a score sink to the bottom.
  const ranked = [...inProgress].sort((a, b) => {
    const sa = scoreByProjectId.get(a.id);
    const sb = scoreByProjectId.get(b.id);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });

  const description = `${formatNumber(inProgress.length)} active project${
    inProgress.length === 1 ? "" : "s"
  }${risks.length > 0 ? ` · sorted by risk (n=${risks.length})` : ""}`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader title="Monitor — active projects" description={description} />

      {ranked.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No in-progress projects right now"
          description="This portfolio has no rows with final_status = 'In Progress'. Completed work lives in Projects and Anomalies."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card ring-1 ring-foreground/5">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="w-10 px-3 py-2">
                  <span className="sr-only">Watch</span>
                </th>
                <th className="w-14 px-3 py-2 text-meta uppercase tracking-wide text-muted-foreground">
                  Risk
                </th>
                <th className="px-3 py-2 text-meta uppercase tracking-wide text-muted-foreground">
                  Project
                </th>
                <th className="px-3 py-2 text-meta uppercase tracking-wide text-muted-foreground">
                  Type
                </th>
                <th className="px-3 py-2 text-meta uppercase tracking-wide text-muted-foreground">
                  Region
                </th>
                <th className="px-3 py-2 text-right text-meta uppercase tracking-wide text-muted-foreground">
                  Contract
                </th>
                <th className="px-3 py-2 text-right text-meta uppercase tracking-wide text-muted-foreground">
                  Delay
                </th>
                <th className="px-3 py-2 text-meta uppercase tracking-wide text-muted-foreground">
                  Flags
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => {
                const score = scoreByProjectId.get(p.id);
                const flags = (p.anomaly_flags ?? []).filter(
                  (f) => FLAG_TO_CATEGORY[f] != null,
                );
                return (
                  <tr
                    key={p.id}
                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2 align-middle">
                      <WatchlistToggle
                        projectId={p.id}
                        projectName={p.project_name}
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {score != null ? (
                        <RiskDial score={score} size="sm" />
                      ) : (
                        <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-meta text-muted-foreground">
                          n/a
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex flex-col">
                        <span className="text-body text-foreground">
                          {p.project_name ?? "—"}
                        </span>
                        <span className="font-mono text-meta text-muted-foreground">
                          {p.project_id_external ?? p.id.slice(0, 8)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle text-body text-foreground">
                      {p.project_type ?? "—"}
                    </td>
                    <td className="px-3 py-2 align-middle text-body text-foreground">
                      {p.region ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-foreground">
                      {p.contract_value_usd != null
                        ? formatCurrency(p.contract_value_usd)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-foreground">
                      {p.delay_days != null
                        ? `${formatNumber(p.delay_days)}d`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {flags.length === 0 ? (
                        <span className="text-meta text-muted-foreground">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {flags.map((f) => (
                            <AnomalyBadge
                              key={f}
                              category={FLAG_TO_CATEGORY[f]}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
