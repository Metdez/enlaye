// Portfolio overview — decision surface lead: risk + signals first, then charts.
// WHY: server component. Fetches portfolios / projects / risk_scores /
// heuristic_rules in parallel and joins risk → project in memory. The
// interactive bits (risk "why" popover, compute-scores empty state,
// collapsible mix breakdowns) live in client children so the page stays
// as thin data plumbing.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { Upload } from "lucide-react";

import { CleaningReport } from "@/components/features/cleaning-report";
import { PortfolioRiskPanel } from "@/components/features/portfolio-risk-panel";
import { PortfolioSignals } from "@/components/features/portfolio-signals";
import { PortfolioSummary } from "@/components/features/portfolio-summary";
import { KpiTile } from "@/components/data/kpi-tile";
import { RiskDial } from "@/components/data/risk-dial";
import { EmptyState } from "@/components/state/empty-state";
import { SectionHeader } from "@/components/state/section-header";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import type {
  HeuristicRule,
  Portfolio,
  ProjectRow,
  RiskScore,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function PortfolioOverviewPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioResult, projectsResult, risksResult, rulesResult] =
    await Promise.all([
      supabase
        .from("portfolios")
        .select(
          "id, name, row_count, anomaly_count, cleaning_report, created_at",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("projects")
        .select(
          "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
        )
        .eq("portfolio_id", id)
        .order("project_id_external", { ascending: true }),
      supabase
        .from("risk_scores")
        .select("id, project_id, portfolio_id, score, breakdown, computed_at")
        .eq("portfolio_id", id),
      supabase
        .from("heuristic_rules")
        .select(
          "id, portfolio_id, scope, outcome, rate, sample_size, ci_low, ci_high, confidence, computed_at",
        )
        .eq("portfolio_id", id)
        .order("sample_size", { ascending: false })
        .order("rate", { ascending: false }),
    ]);

  if (portfolioResult.error) {
    throw new Error(
      `Failed to load portfolio: ${portfolioResult.error.message}`,
    );
  }
  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }
  // WHY: risk / rules are non-fatal — if analyze hasn't run yet we still
  // render the page and prompt the user to compute.
  if (risksResult.error) {
    console.warn("risk_scores fetch failed:", risksResult.error.message);
  }
  if (rulesResult.error) {
    console.warn("heuristic_rules fetch failed:", rulesResult.error.message);
  }
  if (!portfolioResult.data) notFound();

  const portfolio = portfolioResult.data as Portfolio;
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const risks = (risksResult.data ?? []) as RiskScore[];
  const rules = (rulesResult.data ?? []) as HeuristicRule[];

  // In-memory left join: score per project. We keep the map for the AnomalyList
  // shape (which the Anomalies page re-uses); here we only need a lookup.
  const riskByProject = new Map<string, RiskScore>();
  for (const r of risks) riskByProject.set(r.project_id, r);

  // Ranked top-5 projects by score desc. Projects without a score are omitted
  // here — the panel's empty state covers the "no scores yet" case.
  const ranked = projects
    .map((p) => {
      const r = riskByProject.get(p.id);
      return r ? { project: p, score: r } : null;
    })
    .filter((x): x is { project: ProjectRow; score: RiskScore } => x !== null)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 5);

  // Portfolio-wide avg risk. `—` when analyze hasn't run.
  const avgRisk =
    risks.length > 0
      ? risks.reduce((acc, r) => acc + r.score, 0) / risks.length
      : null;

  // KPI aggregations — one pass over projects.
  let totalContract = 0;
  let completed = 0;
  let inProgress = 0;
  for (const p of projects) {
    if (p.contract_value_usd != null && Number.isFinite(p.contract_value_usd)) {
      totalContract += p.contract_value_usd;
    }
    if (p.final_status === "Completed") completed += 1;
    else if (p.final_status === "In Progress") inProgress += 1;
  }

  const avgRiskLabel =
    avgRisk == null ? "—" : Math.round(avgRisk).toString();

  const description = `Created ${formatDate(portfolio.created_at)} · ${formatNumber(
    portfolio.row_count,
  )} rows · ${formatNumber(portfolio.anomaly_count)} flagged${
    avgRisk != null ? ` · avg risk ${avgRiskLabel}` : ""
  }`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader title={portfolio.name} description={description} />

      <CleaningReport
        report={portfolio.cleaning_report ?? {}}
        rowCount={portfolio.row_count}
        anomalyCount={portfolio.anomaly_count}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="No projects in this portfolio"
          description="The portfolio exists but has no rows. Re-upload the CSV to populate it."
        />
      ) : (
        <>
          {/* KPI strip — 4 tiles; avg-risk tile composes a small dial inline
              so the number is legible and the band color is visible. */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiTile
              label="Total contract value"
              value={formatCurrency(totalContract)}
            />
            <KpiTile label="Completed" value={completed} />
            <KpiTile label="In progress" value={inProgress} />
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-1">
                <p className="text-meta uppercase tracking-wide">
                  Avg risk score
                </p>
                <p className="text-h1 tabular-nums">{avgRiskLabel}</p>
                <p className="text-meta text-muted-foreground">
                  n={risks.length}
                </p>
              </div>
              {avgRisk != null ? (
                <RiskDial score={avgRisk} size="md" />
              ) : (
                <div
                  aria-hidden
                  className="size-14 rounded-full border border-dashed border-border"
                />
              )}
            </div>
          </div>

          <PortfolioSummary portfolio={portfolio} projects={projects} />

          <PortfolioRiskPanel
            portfolioId={portfolio.id}
            ranked={ranked}
            hasAnyScore={risks.length > 0}
          />

          <PortfolioSignals rules={rules} />
        </>
      )}
    </div>
  );
}
