// Insights feed — salience-ranked heuristic rules as auto-generated cards.
// WHY: server component. The salience math (and per-outcome baseline) is
// pure computation over the rules list; doing it here keeps the page
// cacheable per-portfolio and the InsightCard dumb.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { Lightbulb } from "lucide-react";

import { InsightCard } from "@/components/features/insight-card";
import { EmptyState } from "@/components/state/empty-state";
import { SectionHeader } from "@/components/state/section-header";
import { createServerSupabase } from "@/lib/supabase";
import type {
  HeuristicRule,
  HeuristicRuleConfidence,
  HeuristicRuleOutcome,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// WHY: must match the salience model used on the Overview "Signals you
// should know" panel. Low-confidence rules still surface (they're dimmed
// downstream) but weight less; high-confidence rules are amplified.
const CONFIDENCE_MULT: Record<HeuristicRuleConfidence, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.5,
};

const TOP_N = 12;

/** Portfolio-wide rate per outcome, weighted by sample_size.
 *  sum(rate * n) / sum(n) — so big cohorts anchor the baseline. */
function baselineRates(
  rules: HeuristicRule[],
): Map<HeuristicRuleOutcome, number> {
  const numerator = new Map<HeuristicRuleOutcome, number>();
  const denominator = new Map<HeuristicRuleOutcome, number>();
  for (const r of rules) {
    numerator.set(
      r.outcome,
      (numerator.get(r.outcome) ?? 0) + r.rate * r.sample_size,
    );
    denominator.set(
      r.outcome,
      (denominator.get(r.outcome) ?? 0) + r.sample_size,
    );
  }
  const out = new Map<HeuristicRuleOutcome, number>();
  for (const [outcome, n] of denominator) {
    if (n > 0) out.set(outcome, (numerator.get(outcome) ?? 0) / n);
  }
  return out;
}

function salience(
  rule: HeuristicRule,
  baseline: Map<HeuristicRuleOutcome, number>,
): number {
  const base = baseline.get(rule.outcome) ?? 0;
  return (
    Math.abs(rule.rate - base) *
    CONFIDENCE_MULT[rule.confidence] *
    Math.sqrt(rule.sample_size)
  );
}

export default async function InsightsPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, rulesRes] = await Promise.all([
    supabase.from("portfolios").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("heuristic_rules")
      .select(
        "id, portfolio_id, scope, outcome, rate, sample_size, ci_low, ci_high, confidence, computed_at",
      )
      .eq("portfolio_id", id),
  ]);

  if (rulesRes.error) {
    // Non-fatal — show the empty state rather than a 500.
    console.warn("heuristic_rules fetch failed:", rulesRes.error.message);
  }
  if (!portfolioRes.data) notFound();

  const rules = (rulesRes.data ?? []) as HeuristicRule[];
  const baseline = baselineRates(rules);

  const ranked = [...rules]
    .map((rule) => ({
      rule,
      score: salience(rule, baseline),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader
        title="Insights"
        description="Patterns emerging from your portfolio. Low-confidence cards are dimmed."
      />

      {ranked.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No insights yet"
          description="Run the analyze endpoint on this portfolio to generate driver rules. Insights populate once at least one rule passes the n≥3 threshold."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ranked.map(({ rule, score }) => (
            <InsightCard
              key={rule.id}
              rule={rule}
              baseRate={baseline.get(rule.outcome) ?? 0}
              salience={score}
              portfolioId={id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
