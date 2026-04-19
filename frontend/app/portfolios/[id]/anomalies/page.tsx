// Anomalies page — flagged projects grouped by project or by category.
// WHY: server component fetches the projects and hands them to AnomalyList,
// which filters to rows with at least one flag and owns the view toggle.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { AnomalyList } from "@/components/features/anomaly-list";
import { SectionHeader } from "@/components/state/section-header";
import { formatNumber } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import type { ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function AnomaliesPage({
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
  const flaggedCount = projects.filter(
    (p) => (p.anomaly_flags ?? []).length > 0,
  ).length;

  const description = `${formatNumber(flaggedCount)} of ${formatNumber(
    projects.length,
  )} projects flagged`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader title="Anomalies" description={description} />
      <AnomalyList projects={projects} />
    </div>
  );
}
