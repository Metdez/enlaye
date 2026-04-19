// Portfolio overview: cleaning report + KPI tiles + charts.
// WHY: server component fetching both the portfolio row (for header meta +
// cleaning report) and the full project set (for KPI aggregations + charts).
// Aggregation lives in [PortfolioSummary](../../../components/features/portfolio-summary.tsx)
// to keep this page a thin data-fetching shell.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { Upload } from "lucide-react";

import { CleaningReport } from "@/components/features/cleaning-report";
import { PortfolioSummary } from "@/components/features/portfolio-summary";
import { EmptyState } from "@/components/state/empty-state";
import { SectionHeader } from "@/components/state/section-header";
import { formatDate, formatNumber } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio, ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function PortfolioOverviewPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioResult, projectsResult] = await Promise.all([
    supabase
      .from("portfolios")
      .select("id, name, row_count, anomaly_count, cleaning_report, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("projects")
      // WHY: pull every column PortfolioSummary reads — region for the donut,
      // project_type/delay_days/cost_overrun_pct for grouped bars, plus the
      // totals columns. Cheaper than a second round trip per chart.
      .select(
        "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
      )
      .eq("portfolio_id", id)
      .order("project_id_external", { ascending: true }),
  ]);

  if (portfolioResult.error) {
    throw new Error(
      `Failed to load portfolio: ${portfolioResult.error.message}`,
    );
  }
  if (projectsResult.error) {
    throw new Error(
      `Failed to load projects: ${projectsResult.error.message}`,
    );
  }
  if (!portfolioResult.data) notFound();

  const portfolio = portfolioResult.data as Portfolio;
  const projects = (projectsResult.data ?? []) as ProjectRow[];

  const description = `Created ${formatDate(portfolio.created_at)} · ${formatNumber(
    portfolio.row_count,
  )} rows · ${formatNumber(portfolio.anomaly_count)} anomalies`;

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
        <PortfolioSummary portfolio={portfolio} projects={projects} />
      )}
    </div>
  );
}
