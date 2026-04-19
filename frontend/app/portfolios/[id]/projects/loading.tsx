// Projects route skeleton.
// WHY: table is the dominant visual — match the real page shape so switching
// tabs doesn't feel jumpy.

import type { ReactElement } from "react";

import { TableSkeleton } from "@/components/state/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectsLoading(): ReactElement {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8"
      role="status"
      aria-live="polite"
      aria-label="Loading projects"
    >
      <span className="sr-only">Loading projects…</span>

      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3.5 w-24" />
      </div>

      <TableSkeleton rows={10} columns={8} />
    </div>
  );
}
