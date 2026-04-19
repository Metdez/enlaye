// Pre-construction intake — scenario simulator page.
// WHY: server component. We fetch the portfolio's projects to feed two
// things: (1) the dedup'd project_type / region dropdowns so the form can
// only propose values present in the cohort, and (2) a projectsById map
// so the ScenarioSimulator can render the "Similar projects" list without
// a second round-trip from the client.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { ScenarioSimulator } from "@/components/features/scenario-simulator";
import { SectionHeader } from "@/components/state/section-header";
import { createServerSupabase } from "@/lib/supabase";
import type { ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// WHY: hard fallback for the 5 demo categories. If the portfolio has zero
// rows (or all rows are missing the field) we still want the form to work
// so the reviewer can poke at it. Matches the buckets the backend encodes.
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

export default async function ScreenPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, projectsRes] = await Promise.all([
    supabase.from("portfolios").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("projects")
      .select(
        "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
      )
      .eq("portfolio_id", id),
  ]);

  if (projectsRes.error) {
    throw new Error(`Failed to load projects: ${projectsRes.error.message}`);
  }
  if (!portfolioRes.data) notFound();

  const projects = (projectsRes.data ?? []) as ProjectRow[];

  const typeOptions = uniqSorted(
    projects.map((p) => p.project_type),
    FALLBACK_TYPES,
  );
  const regionOptions = uniqSorted(
    projects.map((p) => p.region),
    FALLBACK_REGIONS,
  );

  // Build a projected lookup table — only the columns the ScenarioSimulator
  // actually renders. Avoids sending the full ProjectRow shape (and its
  // anomaly_flags arrays) through the RSC payload.
  const projectsById: Record<
    string,
    {
      id: string;
      project_name: string | null;
      project_id_external: string | null;
      delay_days: number | null;
      cost_overrun_pct: number | null;
      final_status: string | null;
    }
  > = {};
  for (const p of projects) {
    projectsById[p.id] = {
      id: p.id,
      project_name: p.project_name,
      project_id_external: p.project_id_external,
      delay_days: p.delay_days,
      cost_overrun_pct: p.cost_overrun_pct,
      final_status: p.final_status,
    };
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader
        title="Pre-construction intake"
        description="Screen a hypothetical project against the portfolio. Cohort-based estimates — not predictions."
      />
      <ScenarioSimulator
        portfolioId={id}
        typeOptions={typeOptions}
        regionOptions={regionOptions}
        projectsById={projectsById}
      />
    </div>
  );
}
