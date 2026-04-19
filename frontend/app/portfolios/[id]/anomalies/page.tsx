// Anomalies page — risk-sorted flagged projects + rules-that-fired panel.
// WHY: server component. Pulls projects + risk_scores + heuristic_rules in
// parallel, passes a score map to AnomalyList so rows sort by risk and each
// card prefixes a small dial. Driver-rule panel surfaces "rules that fired"
// for this portfolio (strong positive OR strong negative signal). Missing
// risk data is non-fatal — the page still lists anomalies as before.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { AnomalyList } from "@/components/features/anomaly-list";
import { RuleCard } from "@/components/data/rule-card";
import { EmptyState } from "@/components/state/empty-state";
import { SectionHeader } from "@/components/state/section-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import { Sparkles } from "lucide-react";
import type { HeuristicRule, ProjectRow, RiskScore } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// WHY: "fired" = the rule carries real signal in either direction. Strong
// positives (rate ≥ 0.5) call out heightened risk segments; strong negatives
// that are well-sampled (rate ≤ 0.2 AND n ≥ 3) call out comparatively safe
// segments. Mid-range rates are noise for this panel.
function didFire(rule: HeuristicRule): boolean {
  if (rule.rate >= 0.5) return true;
  if (rule.rate <= 0.2 && rule.sample_size >= 3) return true;
  return false;
}

export default async function AnomaliesPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, projectsRes, risksRes, rulesRes] = await Promise.all([
    supabase.from("portfolios").select("id").eq("id", id).maybeSingle(),
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
      .eq("portfolio_id", id),
  ]);

  if (projectsRes.error) {
    throw new Error(`Failed to load projects: ${projectsRes.error.message}`);
  }
  if (risksRes.error) {
    console.warn("risk_scores fetch failed:", risksRes.error.message);
  }
  if (rulesRes.error) {
    console.warn("heuristic_rules fetch failed:", rulesRes.error.message);
  }
  if (!portfolioRes.data) notFound();

  const projects = (projectsRes.data ?? []) as ProjectRow[];
  const risks = (risksRes.data ?? []) as RiskScore[];
  const rules = (rulesRes.data ?? []) as HeuristicRule[];

  const scoreByProjectId = new Map<string, number>();
  for (const r of risks) scoreByProjectId.set(r.project_id, r.score);

  const firedRules = rules.filter(didFire);
  // WHY: within "fired", order by absolute deviation from 0.5 so the sharpest
  // signals (both high and low) come first.
  firedRules.sort(
    (a, b) => Math.abs(b.rate - 0.5) - Math.abs(a.rate - 0.5),
  );

  const flaggedCount = projects.filter(
    (p) => (p.anomaly_flags ?? []).length > 0,
  ).length;

  const description = `${formatNumber(flaggedCount)} of ${formatNumber(
    projects.length,
  )} projects flagged${
    risks.length > 0 ? ` · sorted by risk (n=${risks.length})` : ""
  }`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader title="Anomalies" description={description} />

      <AnomalyList
        projects={projects}
        scoreByProjectId={
          scoreByProjectId.size > 0 ? scoreByProjectId : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Driver rules that fired</CardTitle>
        </CardHeader>
        <CardContent>
          {firedRules.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No strong segment signals"
              description="No driver rules passed the fire threshold (rate ≥ 50% or rate ≤ 20% with n ≥ 3). Run analyze or add more projects."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {firedRules.map((r) => (
                <RuleCard key={r.id} rule={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
