// Portfolio detail page — header, cleaning summary, projects table.
// WHY: server component so the initial load is SSR'd with no client-side
// data fetching dance. Interactivity is scoped to the cleaning-report
// panel (client), not the page shell.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio, ProjectRow } from "@/lib/types";
import { CleaningReportPanel } from "@/components/cleaning-report-panel";
import { ProjectsTable } from "@/components/projects-table";

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
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-6 text-sm">
        <Link
          href="/"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← All portfolios
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {portfolio.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Created {formatCreatedAt(portfolio.created_at)} ·{" "}
          <span className="tabular-nums">{portfolio.row_count}</span> rows ·{" "}
          <span className="tabular-nums">{portfolio.anomaly_count}</span> anomalies
        </p>
      </header>

      <div className="mb-8">
        <CleaningReportPanel
          report={portfolio.cleaning_report ?? {}}
          rowCount={portfolio.row_count}
          anomalyCount={portfolio.anomaly_count}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Projects
        </h2>
        <ProjectsTable rows={projects} />
      </section>
    </main>
  );
}
