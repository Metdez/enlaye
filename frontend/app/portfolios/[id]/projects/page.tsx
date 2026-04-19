// Projects table page — full project list with inline anomaly badges.
// WHY: server component. ProjectsTable owns its own search/sort/empty state,
// so this page just fetches and passes through.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { ProjectsTable } from "@/components/features/projects-table";
import { SectionHeader } from "@/components/state/section-header";
import { formatNumber } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import type { ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProjectsPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, projectsRes] = await Promise.all([
    supabase.from("portfolios").select("id").eq("id", id).maybeSingle(),
    supabase
      .from("projects")
      .select(
        "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
      )
      .eq("portfolio_id", id)
      .order("project_id_external", { ascending: true }),
  ]);

  if (projectsRes.error) {
    throw new Error(`Failed to load projects: ${projectsRes.error.message}`);
  }
  if (!portfolioRes.data) notFound();

  const projects = (projectsRes.data ?? []) as ProjectRow[];
  const description =
    projects.length === 1
      ? "1 row"
      : `${formatNumber(projects.length)} rows`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader title="Projects" description={description} />
      <ProjectsTable rows={projects} />
    </div>
  );
}
