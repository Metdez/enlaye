"use client";

// Top-5 risk exposure module for the Overview page.
// WHY: client component because the "why" popover is interactive and the
// empty-state "Compute risk scores" button fires a POST + router.refresh().
// Keeping the server page thin — it passes already-joined rows down.

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";

import { RiskDial } from "@/components/data/risk-dial";
import { EmptyState } from "@/components/state/empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatPercent } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type {
  ProjectRow,
  RiskBreakdown,
  RiskScore,
  RiskSubscoreKey,
} from "@/lib/types";

// WHY: humanize the subscore keys in one place. New subscores added to the
// backend will surface as "Type risk" etc. via a fallback — but ideally we
// add a mapping here first so the UI tone is intentional.
const SUBSCORE_LABEL: Record<RiskSubscoreKey, string> = {
  type_risk: "Project type",
  region_risk: "Region",
  size_risk: "Contract size",
  complexity_risk: "Complexity",
  duration_risk: "Duration",
};

function topDriverLabel(breakdown: RiskBreakdown): string {
  return SUBSCORE_LABEL[breakdown.top_driver] ?? breakdown.top_driver;
}

type RankedProject = {
  project: ProjectRow;
  score: RiskScore;
};

type PortfolioRiskPanelProps = {
  portfolioId: string;
  ranked: RankedProject[]; // already sorted desc by score, top 5
  hasAnyScore: boolean;
};

export function PortfolioRiskPanel({
  portfolioId,
  ranked,
  hasAnyScore,
}: PortfolioRiskPanelProps): ReactElement {
  const router = useRouter();
  const [computing, setComputing] = useState(false);

  const runAnalyze = async () => {
    if (computing) return;
    setComputing(true);
    try {
      const res = await fetch("/api/ml/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: unknown;
        };
        const detail =
          typeof body.detail === "string"
            ? body.detail
            : res.statusText || `HTTP ${res.status}`;
        throw new Error(detail);
      }
      toastSuccess("Risk scores computed", {
        description: "Refreshing portfolio…",
      });
      router.refresh();
    } catch (err) {
      toastError("Analyze failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setComputing(false);
    }
  };

  if (!hasAnyScore) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top risk exposure</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={ShieldAlert}
            title="No risk scores yet"
            description="Run analyze to compute the composite 0-100 score for each project, plus the driver rules that fired on this portfolio."
            action={
              <Button
                type="button"
                onClick={() => void runAnalyze()}
                disabled={computing}
              >
                {computing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Computing…
                  </>
                ) : (
                  "Compute risk scores"
                )}
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top risk exposure — {ranked.length} projects</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border" aria-label="Top risk projects">
          {ranked.map(({ project, score }) => {
            const name =
              project.project_name ?? project.project_id_external ?? "—";
            const id = project.project_id_external ?? project.id.slice(0, 8);
            return (
              <li
                key={project.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <RiskDial score={score.score} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-foreground">{name}</p>
                  <p className="text-meta text-muted-foreground">
                    <span className="font-mono">{id}</span> · top driver:{" "}
                    <span className="text-foreground">
                      {topDriverLabel(score.breakdown)}
                    </span>
                  </p>
                </div>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button type="button" variant="ghost" size="xs">
                        Why
                      </Button>
                    }
                  />
                  <PopoverContent align="end" className="w-80">
                    <WhyPopoverBody breakdown={score.breakdown} score={score.score} />
                  </PopoverContent>
                </Popover>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function WhyPopoverBody({
  breakdown,
  score,
}: {
  breakdown: RiskBreakdown;
  score: number;
}): ReactElement {
  // WHY: show weighted contribution, not just the raw subscore — the user
  // cares about what moved the composite, not what the feature scored on its
  // own. Contribution = subscore * weight * 100, matches server arithmetic.
  const rows = (Object.keys(breakdown.subscores) as RiskSubscoreKey[]).map(
    (key) => {
      const sub = breakdown.subscores[key];
      const weight = breakdown.weights[key] ?? 0;
      return {
        key,
        label: SUBSCORE_LABEL[key] ?? key,
        subscore: sub,
        weight,
        contribution: sub * weight * 100,
      };
    },
  );
  rows.sort((a, b) => b.contribution - a.contribution);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-meta uppercase tracking-wide text-muted-foreground">
          Why this score
        </p>
        <p className="font-mono text-sm tabular-nums">{Math.round(score)}</p>
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-center justify-between gap-3 text-body"
          >
            <span
              className={cn(
                "truncate",
                r.key === breakdown.top_driver
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {r.label}
            </span>
            <span className="shrink-0 font-mono text-meta tabular-nums text-foreground">
              {formatPercent(r.contribution, 1)}
            </span>
          </li>
        ))}
      </ul>
      {breakdown.flags.length > 0 ? (
        <p className="text-meta text-muted-foreground">
          Flags: {breakdown.flags.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
