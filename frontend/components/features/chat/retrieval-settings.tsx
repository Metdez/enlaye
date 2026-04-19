"use client";

// Retrieval settings panel — top_k + threshold sliders.
// WHY: native <input type="range"> with `accent-primary` stays keyboard-
// navigable and honors the system high-contrast mode automatically.
// Controlled component — parent owns the state so the query payload stays
// in one place.

import { useId, type ReactElement } from "react";
import { HelpCircle } from "lucide-react";

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
import { cn } from "@/lib/utils";

export type RetrievalValues = {
  topK: number;
  threshold: number;
};

type RetrievalSettingsProps = {
  values: RetrievalValues;
  onChange: (next: RetrievalValues) => void;
  className?: string;
};

export const DEFAULT_RETRIEVAL: RetrievalValues = { topK: 8, threshold: 0.3 };

/** top_k + threshold sliders in a card. Emits the full value object per change. */
export function RetrievalSettings({
  values,
  onChange,
  className,
}: RetrievalSettingsProps): ReactElement {
  const topKId = useId();
  const thresholdId = useId();

  const rangeClass =
    "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Card size="sm" className={cn(className)}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Retrieval</CardTitle>
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="What is this?"
                  className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <HelpCircle className="size-4" aria-hidden />
                </button>
              }
            />
            <PopoverContent side="bottom" align="end" className="text-body">
              <p className="font-medium text-foreground">What is this?</p>
              <p className="mt-1 text-muted-foreground">
                <span className="font-mono">top_k</span> is how many document
                chunks we pull. <span className="font-mono">threshold</span> is
                the minimum cosine similarity a chunk must clear.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor={topKId}
              className="text-meta uppercase tracking-wide text-muted-foreground"
            >
              top_k
            </label>
            <span className="text-body font-mono tabular-nums text-foreground">
              {values.topK}
            </span>
          </div>
          <input
            id={topKId}
            type="range"
            min={3}
            max={20}
            step={1}
            value={values.topK}
            onChange={(e) =>
              onChange({
                ...values,
                topK: Number.parseInt(e.target.value, 10),
              })
            }
            className={rangeClass}
            aria-label="Number of chunks to retrieve"
          />
          <p className="text-meta text-muted-foreground">
            Chunks per question. Higher = more context, more noise.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor={thresholdId}
              className="text-meta uppercase tracking-wide text-muted-foreground"
            >
              threshold
            </label>
            <span className="text-body font-mono tabular-nums text-foreground">
              {values.threshold.toFixed(2)}
            </span>
          </div>
          <input
            id={thresholdId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={values.threshold}
            onChange={(e) =>
              onChange({
                ...values,
                threshold: Number.parseFloat(e.target.value),
              })
            }
            className={rangeClass}
            aria-label="Minimum similarity threshold"
          />
          <p className="text-meta text-muted-foreground">
            Minimum similarity. Lower = broader matches, higher = stricter.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
