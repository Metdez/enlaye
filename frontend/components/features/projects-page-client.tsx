"use client";

// Client wrapper for the projects page. Owns the edit-sheet state and which
// row is currently open. The server page passes rows + portfolio context
// down as serializable props; this island takes over for interaction.

import { useCallback, useState, type ReactElement } from "react";

import { ProjectEditSheet } from "@/components/features/project-edit-sheet";
import { ProjectsActionsBar } from "@/components/features/projects-actions-bar";
import { ProjectsTable } from "@/components/features/projects-table";
import type { ProjectRow } from "@/lib/types";

type ProjectsPageClientProps = {
  portfolioId: string;
  rows: ProjectRow[];
  typeOptions: string[];
  regionOptions: string[];
  manualCount: number;
};

export function ProjectsPageClient({
  portfolioId,
  rows,
  typeOptions,
  regionOptions,
  manualCount,
}: ProjectsPageClientProps): ReactElement {
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [open, setOpen] = useState(false);

  const handleRowClick = useCallback((row: ProjectRow) => {
    setEditing(row);
    setOpen(true);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // Defer clearing so the sheet's close animation doesn't flash an empty
    // form as the row context disappears.
    if (!next) {
      window.setTimeout(() => setEditing(null), 200);
    }
  }, []);

  return (
    <div className="space-y-4">
      <ProjectsActionsBar
        portfolioId={portfolioId}
        typeOptions={typeOptions}
        regionOptions={regionOptions}
        projectCount={rows.length}
        manualCount={manualCount}
      />
      <ProjectsTable rows={rows} onRowClick={handleRowClick} />
      {editing ? (
        <ProjectEditSheet
          project={editing}
          portfolioId={portfolioId}
          typeOptions={typeOptions}
          regionOptions={regionOptions}
          open={open}
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </div>
  );
}
