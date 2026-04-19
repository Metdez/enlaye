"use client";

// Collapsible wrapper around the existing PortfolioSummary charts.
// WHY: 8a moves the decision surface (risk + signals) above the fold. The
// legacy mix charts still have value for exploratory scanning, so we keep
// them but collapsed by default so the page lands on the new content. A
// plain details-style toggle matches the pattern already used in
// cleaning-report.tsx — consistent UX for "extra context is behind this
// chevron."

import { useId, useState, type ReactElement } from "react";
import { ChevronDown } from "lucide-react";

import { PortfolioSummary } from "@/components/features/portfolio-summary";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Portfolio, ProjectRow } from "@/lib/types";

export function MixBreakdownsCollapsible({
  portfolio,
  projects,
}: {
  portfolio: Portfolio;
  projects: ProjectRow[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Card size="sm" className="p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0 flex-1">
          <p className="text-meta uppercase tracking-wide">Mix breakdowns</p>
          <p className="mt-0.5 text-body text-foreground">
            Charts by type, region, and overrun
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-border px-4 py-4">
          <PortfolioSummary portfolio={portfolio} projects={projects} />
        </div>
      ) : null}
    </Card>
  );
}
