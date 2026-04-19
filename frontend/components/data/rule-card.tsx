// Driver rule card — one heuristic rule rendered as prose + stats.
// WHY: reviewers need to read "Infrastructure projects have a 45% rate of cost
// overrun" before they read "n=6, CI 22-68". The human sentence comes first;
// n + CI + confidence sit in the meta row. A plain div keeps the padding under
// our control — the shadcn Card adds its own py/rx that fight tight stacks.

import { StatusDot, type StatusTone } from "@/components/data/status-dot";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  HeuristicRule,
  HeuristicRuleConfidence,
  HeuristicRuleOutcome,
} from "@/lib/types";

// WHY: these map to the four outcomes the Python `drivers.py` module emits.
// Keeping the copy here means if drivers adds a fifth outcome the typecheck
// will force an update at the call site.
const OUTCOME_PHRASE: Record<HeuristicRuleOutcome, string> = {
  high_overrun: "cost overrun above 25%",
  high_delay: "delays beyond 150 days",
  any_safety_incident: "at least one safety incident",
  any_dispute: "at least one payment dispute",
};

// Tone → StatusDot semantic mapping. "low" confidence is a caution, not an error.
const CONFIDENCE_TONE: Record<HeuristicRuleConfidence, StatusTone> = {
  low: "warning",
  medium: "info",
  high: "success",
};

/** Turn `project_type=Infrastructure` into "Infrastructure" (drop the key). */
function humanizeScope(scope: string): string {
  const eq = scope.indexOf("=");
  if (eq < 0) return scope;
  const key = scope.slice(0, eq);
  const val = scope.slice(eq + 1).trim();
  // WHY: naming the segment ("large-size") reads worse than just the value for
  // the common keys; fall back to "<value> (<key>)" only when the value alone
  // would be ambiguous, e.g. size_bucket where "small" needs context.
  if (key === "size_bucket") return `${val} size-bucket`;
  if (key === "region") return `${val} region`;
  if (key === "project_type") return val;
  return `${val} (${key})`;
}

/** Build the prose sentence. Bold-worthy span is returned separately so the
 *  JSX can render it with a <strong>. */
function phraseFor(rule: HeuristicRule): { prefix: string; bold: string; suffix: string } {
  const subject = humanizeScope(rule.scope);
  const outcome = OUTCOME_PHRASE[rule.outcome];
  return {
    prefix: `${subject} projects have a `,
    bold: formatPercent(rule.rate * 100, 0),
    suffix: ` rate of ${outcome}.`,
  };
}

type RuleCardProps = {
  rule: HeuristicRule;
  className?: string;
};

export function RuleCard({ rule, className }: RuleCardProps) {
  const { prefix, bold, suffix } = phraseFor(rule);
  const confidenceLabel =
    rule.confidence[0].toUpperCase() + rule.confidence.slice(1);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-card p-3",
        className,
      )}
    >
      <p className="text-body text-foreground">
        {prefix}
        <strong className="font-semibold tabular-nums">{bold}</strong>
        {suffix}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
        <span className="tabular-nums">
          n={rule.sample_size} · 95% CI{" "}
          {formatPercent(rule.ci_low * 100, 0)}–{formatPercent(rule.ci_high * 100, 0)}
        </span>
        <StatusDot
          tone={CONFIDENCE_TONE[rule.confidence]}
          label={`${confidenceLabel} confidence`}
          className="text-meta"
        />
      </div>
    </div>
  );
}
