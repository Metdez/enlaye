"use client";

// Inline [C1] citation chip rendered inside assistant answers.
// WHY: click should scroll the matching SourceCard into view and briefly
// highlight it. Chips use the sidebar-accent tokens so they stay legible
// on both the primary-tinted user bubbles and the muted assistant bubbles.

import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

type CitationChipProps = {
  index: number; // 1-based — matches the `[C<n>]` in the model output.
  onClick?: (index: number) => void;
  className?: string;
};

/** Small inline chip showing a 1-based citation index, e.g. `C1`. */
export function CitationChip({
  index,
  onClick,
  className,
}: CitationChipProps): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onClick?.(index)}
      aria-label={`Jump to source ${index}`}
      className={cn(
        "mx-0.5 inline-flex items-center rounded-sm bg-sidebar-accent px-1.5 py-0.5 text-meta font-medium text-sidebar-accent-foreground transition-colors duration-150 hover:bg-sidebar-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
        className,
      )}
    >
      C{index}
    </button>
  );
}
