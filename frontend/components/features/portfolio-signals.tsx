// "Signals you should know" — top driver rules ranked by salience.
// WHY: server component (pure computation + render). Salience mixes three
// signals: how far the rule's rate is from the portfolio baseline for the
// same outcome, a confidence multiplier, and √n for sample-size weighting.
// Rules that are "interesting AND trustworthy AND well-sampled" float up.

import type { ReactElement } from "react";

import { RuleCard } from "@/components/data/rule-card";
import { EmptyState } from "@/components/state/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import type {
  HeuristicRule,
  HeuristicRuleConfidence,
  HeuristicRuleOutcome,
} from "@/lib/types";

const CONFIDENCE_MULT: Record<HeuristicRuleConfidence, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.5,
};

/** Per-outcome baseline rate across the portfolio — weighted by sample size
 *  so a rule's "delta from baseline" compares apples to apples. */
function baselineRates(rules: HeuristicRule[]): Map<HeuristicRuleOutcome, number> {
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

export function PortfolioSignals({
  rules,
}: {
  rules: HeuristicRule[];
}): ReactElement {
  if (rules.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Signals you should know</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="No signals yet"
            description="Run analyze to surface driver rules: per-segment rates of overrun, delay, safety incidents, and disputes with Wilson 95% CIs."
          />
        </CardContent>
      </Card>
    );
  }

  const baseline = baselineRates(rules);
  const ranked = [...rules]
    .map((r) => ({ rule: r, score: salience(r, baseline) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ rule }) => rule);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signals you should know</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ranked.map((r) => (
            <RuleCard key={r.id} rule={r} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
