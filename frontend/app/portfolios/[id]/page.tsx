// Portfolio detail page — dashboard shell + overview + projects + anomalies.
// WHY: server component so the initial load is SSR'd with no client-side
// data fetching dance. Interactivity is scoped to client leaves (cleaning
// report panel, Recharts summary), not the page shell. Sections are anchored
// with #overview / #projects / #anomalies so the sidebar nav can jump to them.

import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio, ProjectRow } from "@/lib/types";
import { CleaningReportPanel } from "@/components/cleaning-report-panel";
import { ProjectsTable } from "@/components/projects-table";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { AnomalyList } from "@/components/anomaly-list";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(iso: string): string {
  try {
    return dateFormatter.format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function PortfolioDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // WHY: fetch in parallel — the projects query does not depend on the
  // portfolio existing, and we want both before deciding to render.
  const [portfolioResult, projectsResult] = await Promise.all([
    supabase
      .from("portfolios")
      .select("id, name, row_count, anomaly_count, cleaning_report, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("projects")
      .select(
        "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
      )
      .eq("portfolio_id", id)
      .order("project_id_external", { ascending: true }),
  ]);

  if (portfolioResult.error) {
    // NOTE: surface the DB error verbatim — easier to debug the cloud-vs-
    // local auth split than to invent our own message.
    throw new Error(
      `Failed to load portfolio: ${portfolioResult.error.message}`,
    );
  }
  if (projectsResult.error) {
    throw new Error(
      `Failed to load projects: ${projectsResult.error.message}`,
    );
  }
  if (!portfolioResult.data) {
    notFound();
  }

  const portfolio = portfolioResult.data as Portfolio;
  const projects = (projectsResult.data ?? []) as ProjectRow[];

  return (
    <DashboardShell portfolio={portfolio}>
      <div className="space-y-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {portfolio.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Created {formatCreatedAt(portfolio.created_at)} ·{" "}
            <span className="tabular-nums">{portfolio.row_count}</span> rows ·{" "}
            <span className="tabular-nums">{portfolio.anomaly_count}</span>{" "}
            anomalies
          </p>
        </header>

        <CleaningReportPanel
          report={portfolio.cleaning_report ?? {}}
          rowCount={portfolio.row_count}
          anomalyCount={portfolio.anomaly_count}
        />

        {/* WHY: id="overview" etc. are the anchor targets the sidebar nav in
            DashboardShell jumps to. Keep these in sync with NAV_ITEMS. */}
        <section id="overview" className="scroll-mt-20 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Overview
          </h2>
          <PortfolioSummary portfolio={portfolio} projects={projects} />
        </section>

        <section id="projects" className="scroll-mt-20 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Projects
          </h2>
          <ProjectsTable rows={projects} />
        </section>

        <section id="anomalies" className="scroll-mt-20 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Anomalies
          </h2>
          <AnomalyList projects={projects} />
        </section>
      </div>
    </DashboardShell>
  );
}
