"use client";

// Inline [C1] citation chip rendered inside assistant answers.
//
// Design: as small and quiet as possible without losing affordance. Sits on
// the text baseline so it doesn't inflate line-height, uses neutral-muted
// colors at rest so a chain of 5+ chips doesn't visually dominate the prose,
// flips to primary tone on hover/focus so the click target still reads.

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
        "mx-[1px] inline-flex h-4 items-center rounded-sm bg-muted px-1 align-[-1px] font-mono text-[10px] font-medium tabular-nums text-muted-foreground transition-colors duration-150",
        "hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      C{index}
    </button>
  );
}
