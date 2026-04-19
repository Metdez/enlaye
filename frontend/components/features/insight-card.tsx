// Insight card — one salient driver rule framed as a natural-language
// finding with a baseline comparison and a drill-down link.
// WHY: server component. Pure rendering; the ranking / baseRate math is
// done on the page. RuleCard is reused inside for the CI + confidence
// meta so the two surfaces stay consistent (Overview "Signals you should
// know" vs. Insights feed).

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";

import { RuleCard } from "@/components/data/rule-card";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  HeuristicRule,
  HeuristicRuleOutcome,
} from "@/lib/types";

// WHY: these phrases mirror `rule-card.tsx`'s OUTCOME_PHRASE but in a form
// that reads well after "have a 45% rate of" — e.g. "cost overrun above
// 25%" works there and here. Keep the two tables in sync if the Python
// drivers module adds a fifth outcome.
const OUTCOME_PHRASE: Record<HeuristicRuleOutcome, string> = {
  high_overrun: "cost overrun above 25%",
  high_delay: "delays beyond 150 days",
  any_safety_incident: "at least one safety incident",
  any_dispute: "at least one payment dispute",
};

/** "project_type=Infrastructure" → "Infrastructure". */
function humanizeScope(scope: string): string {
  const eq = scope.indexOf("=");
  if (eq < 0) return scope;
  const key = scope.slice(0, eq);
  const val = scope.slice(eq + 1).trim();
  if (key === "size_bucket") return `${val} size-bucket`;
  if (key === "region") return `${val} region`;
  if (key === "project_type") return val;
  return `${val} (${key})`;
}

// WHY: a 2-point gap is below the noise floor of a 15-row demo portfolio;
// don't distract the reader with "vs. 27%" when the rule itself is 29%.
const MEANINGFUL_DELTA = 0.02;

type InsightCardProps = {
  rule: HeuristicRule;
  baseRate: number; // 0-1; portfolio-wide rate for this outcome
  /** Salience score — rendered only in screen-reader copy for now. */
  salience: number;
  portfolioId: string;
  className?: string;
};

export function InsightCard({
  rule,
  baseRate,
  salience,
  portfolioId,
  className,
}: InsightCardProps): ReactElement {
  const subject = humanizeScope(rule.scope);
  const outcome = OUTCOME_PHRASE[rule.outcome];
  const delta = rule.rate - baseRate;
  const hasComparison = Math.abs(delta) >= MEANINGFUL_DELTA && baseRate > 0;
  const dimmed = rule.confidence === "low";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/5 transition-opacity",
        dimmed && "opacity-70",
        className,
      )}
      data-salience={salience.toFixed(3)}
    >
      <p className="text-body text-foreground">
        <strong className="font-semibold">{subject}</strong> projects have a{" "}
        <strong className="font-semibold tabular-nums">
          {formatPercent(rule.rate * 100, 0)}
        </strong>{" "}
        rate of {outcome}
        {hasComparison ? (
          <>
            {" — versus "}
            <span className="tabular-nums">
              {formatPercent(baseRate * 100, 0)}
            </span>{" "}
            portfolio-wide.
          </>
        ) : (
          "."
        )}
      </p>

      <RuleCard rule={rule} className="bg-background/40" />

      <div className="flex items-center justify-end">
        <Link
          href={`/portfolios/${portfolioId}/projects`}
          className="inline-flex items-center gap-1 text-meta text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
        >
          View projects
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </div>
  );
}
