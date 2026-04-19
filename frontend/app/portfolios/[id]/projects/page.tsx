// Projects table page — full project list with inline anomaly badges and
// the Phase 8c feedback loop (Add / edit / delete projects).
// WHY: server component. We fetch rows + derive type/region dropdown options
// (same pattern as the Screen page), then hand off to a client island that
// owns the edit-sheet state + mutations.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { ProjectsPageClient } from "@/components/features/projects-page-client";
import { SectionHeader } from "@/components/state/section-header";
import { createServerSupabase } from "@/lib/supabase";
import type { ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// WHY: mirrors the Screen page fallbacks so the Add/Edit form still works
// on a brand-new portfolio with zero rows.
const FALLBACK_TYPES = [
  "Commercial",
  "Energy",
  "Industrial",
  "Infrastructure",
  "Residential",
];

const FALLBACK_REGIONS = [
  "Midwest",
  "Mountain",
  "Northeast",
  "Southeast",
  "Southwest",
];

function uniqSorted(values: Array<string | null>, fallback: string[]): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    if (v && v.trim().length > 0) seen.add(v.trim());
  }
  if (seen.size === 0) return fallback;
  return [...seen].sort((a, b) => a.localeCompare(b));
}

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
        "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags, source",
      )
      .eq("portfolio_id", id)
      .order("project_id_external", { ascending: true }),
  ]);

  if (projectsRes.error) {
    throw new Error(`Failed to load projects: ${projectsRes.error.message}`);
  }
  if (!portfolioRes.data) notFound();

  // WHY: defensively default source to 'csv' for any rows still sitting in
  // the DB before the Phase 8c migration landed (shouldn't exist in prod,
  // but it keeps local dev from crashing when a snapshot is restored mid-
  // migration).
  const projects = ((projectsRes.data ?? []) as Array<
    Omit<ProjectRow, "source"> & { source: ProjectRow["source"] | null }
  >).map<ProjectRow>((p) => ({
    ...p,
    source: p.source ?? "csv",
  }));

  const typeOptions = uniqSorted(
    projects.map((p) => p.project_type),
    FALLBACK_TYPES,
  );
  const regionOptions = uniqSorted(
    projects.map((p) => p.region),
    FALLBACK_REGIONS,
  );

  const manualCount = projects.reduce(
    (n, p) => (p.source === "manual" ? n + 1 : n),
    0,
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader
        title="Projects"
        description="Click a row to edit. Mutations recompute the portfolio risk analysis."
      />
      <ProjectsPageClient
        portfolioId={id}
        rows={projects}
        typeOptions={typeOptions}
        regionOptions={regionOptions}
        manualCount={manualCount}
      />
    </div>
  );
}
