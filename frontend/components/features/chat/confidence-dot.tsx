"use client";

// Confidence dot — high/medium/low badge wrapped in a tooltip.
// WHY: the RAG pipeline returns both a discrete `confidence` level and the
// top-source similarity score. The level drives the tone; the numeric score
// goes in the tooltip so reviewers can see *why* it's graded that way.

import type { ReactElement } from "react";

import { StatusDot, type StatusTone } from "@/components/data/status-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type Confidence = "high" | "medium" | "low";

const TONE: Record<Confidence, StatusTone> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

const LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

type ConfidenceDotProps = {
  confidence: Confidence;
  score?: number | null;
  className?: string;
};

/** Confidence indicator — colored dot + label, optional numeric score on hover. */
export function ConfidenceDot({
  confidence,
  score,
  className,
}: ConfidenceDotProps): ReactElement {
  const dot = (
    <span className={className}>
      <StatusDot tone={TONE[confidence]} label={LABEL[confidence]} />
    </span>
  );

  if (score == null || !Number.isFinite(score)) return dot;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help">{dot}</span>} />
      <TooltipContent>Top similarity: {score.toFixed(2)}</TooltipContent>
    </Tooltip>
  );
}
