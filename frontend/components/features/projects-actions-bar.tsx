"use client";

// Right-aligned actions bar above the projects table.
// WHY: small client island that keeps the "Add project" affordance co-located
// with the table's row count + manual-entry count. Kept as its own file so
// the server page composes it without pulling the entire ProjectsPageClient
// tree when all it needs is the add button.

import type { ReactElement } from "react";

import { ProjectAddDialog } from "@/components/features/project-add-dialog";
import { formatNumber } from "@/lib/format";

type ProjectsActionsBarProps = {
  portfolioId: string;
  typeOptions: string[];
  regionOptions: string[];
  projectCount: number;
  manualCount?: number;
};

export function ProjectsActionsBar({
  portfolioId,
  typeOptions,
  regionOptions,
  projectCount,
  manualCount,
}: ProjectsActionsBarProps): ReactElement {
  const showManual = typeof manualCount === "number" && manualCount > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-meta text-muted-foreground">
        <span className="tabular-nums">{formatNumber(projectCount)}</span>{" "}
        {projectCount === 1 ? "project" : "projects"}
        {showManual ? (
          <>
            {" "}&middot;{" "}
            <span className="tabular-nums">{formatNumber(manualCount)}</span>{" "}
            manually entered
          </>
        ) : null}
      </p>
      <ProjectAddDialog
        portfolioId={portfolioId}
        typeOptions={typeOptions}
        regionOptions={regionOptions}
      />
    </div>
  );
}
