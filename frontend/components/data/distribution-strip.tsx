// P10 / P50 / P90 distribution strip — compact horizontal summary of a numeric column.
// WHY: "mean X" hides outliers; in construction data the tails are the story.
// Rendering P10 and P90 tick marks around a bold P50 dot lets the reader see
// spread at a glance. Sparse columns (< 3 non-null values) render a muted chip
// instead — "n=1" is not a distribution, and pretending otherwise would lie.

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// WHY: two modes, one renderer.
//   - `values` mode (original): pass the raw column; we compute P10/P50/P90
//     and render the strip. Sparse columns (<3 values) render "n/a (n=X)".
//   - `percentiles` mode (Phase 8b): pre-computed percentiles from the
//     simulator endpoint, which returns P25/P50/P75 directly. In this mode
//     we pass `n` explicitly and use the P25/P75 tick labels. Either mode
//     is valid; passing both is a programmer error and typechecking
//     enforces the discriminant.
type DistributionStripValuesProps = {
  values: Array<number | null>;
  formatter?: (n: number) => string;
  className?: string;
  percentiles?: never;
};

type DistributionStripPercentilesProps = {
  percentiles: { p25: number | null; p50: number | null; p75: number | null };
  n: number;
  formatter?: (n: number) => string;
  className?: string;
  values?: never;
};

type DistributionStripProps =
  | DistributionStripValuesProps
  | DistributionStripPercentilesProps;

/** Linear interpolation percentile (Excel-style / numpy default). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function DistributionStrip(props: DistributionStripProps) {
  const { formatter, className } = props;
  const fmt = formatter ?? formatNumber;

  // Branch once on the discriminant so the render path is shared.
  let lo: number;
  let mid: number;
  let hi: number;
  let n: number;
  let loLabel: string;
  let hiLabel: string;

  if ("percentiles" in props && props.percentiles) {
    const { p25, p50, p75 } = props.percentiles;
    // WHY: in percentiles mode we require all three; any null collapses to
    // the n/a chip — a half-drawn strip would mislead. n comes from the
    // caller because the underlying cohort size is no longer derivable.
    if (p25 == null || p50 == null || p75 == null) {
      return (
        <span
          role="img"
          aria-label={`no distribution available, n=${props.n}`}
          className={cn(
            "inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-meta text-muted-foreground",
            className,
          )}
        >
          n/a (n={props.n})
        </span>
      );
    }
    lo = p25;
    mid = p50;
    hi = p75;
    n = props.n;
    loLabel = "P25";
    hiLabel = "P75";
  } else {
    const values = (props as DistributionStripValuesProps).values;
    const present = values.filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    n = present.length;

    // WHY: three points defines the minimum shape of a distribution (P10/P50/P90).
    // Below that we show an explicit n/a chip so no one reads a spurious strip.
    if (n < 3) {
      return (
        <span
          role="img"
          aria-label={`no distribution available, n=${n}`}
          className={cn(
            "inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-meta text-muted-foreground",
            className,
          )}
        >
          n/a (n={n})
        </span>
      );
    }

    const sorted = [...present].sort((a, b) => a - b);
    lo = percentile(sorted, 10);
    mid = percentile(sorted, 50);
    hi = percentile(sorted, 90);
    loLabel = "P10";
    hiLabel = "P90";
  }

  const min = Math.min(lo, mid, hi);
  const max = Math.max(lo, mid, hi);
  // WHY: guard against a collapsed distribution (all equal). A zero-range
  // divisor would produce NaN positions; fall back to 50% everywhere.
  const range = max - min;
  const pct = (v: number) => (range === 0 ? 50 : ((v - min) / range) * 100);
  const p10 = lo;
  const p50 = mid;
  const p90 = hi;

  return (
    <div
      role="img"
      aria-label={`${loLabel} ${fmt(p10)}, P50 ${fmt(p50)}, ${hiLabel} ${fmt(p90)}, n=${n}`}
      className={cn("flex w-full flex-col gap-1", className)}
    >
      {/* Track + tick + dot: a single 10px-tall row. */}
      <div className="relative h-2.5 w-full">
        {/* Neutral track — uses chartColors.neutral tone via muted token. */}
        <div
          className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/30"
          aria-hidden
        />
        {/* P10 tick (short vertical line). */}
        <div
          className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/70"
          style={{ left: `calc(${pct(p10)}% - 1px)` }}
          aria-hidden
        />
        {/* P90 tick. */}
        <div
          className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/70"
          style={{ left: `calc(${pct(p90)}% - 1px)` }}
          aria-hidden
        />
        {/* P50 dot — primary tone, drawn last so it sits above the ticks. */}
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
          style={{ left: `${pct(p50)}%` }}
          aria-hidden
        />
      </div>

      <div className="relative h-4 w-full text-meta text-muted-foreground">
        <span
          className="absolute tabular-nums"
          style={{ left: `${pct(p10)}%`, transform: "translateX(-50%)" }}
        >
          {fmt(p10)}
        </span>
        <span
          className="absolute tabular-nums text-foreground"
          style={{ left: `${pct(p50)}%`, transform: "translateX(-50%)" }}
        >
          {fmt(p50)}
        </span>
        <span
          className="absolute tabular-nums"
          style={{ left: `${pct(p90)}%`, transform: "translateX(-50%)" }}
        >
          {fmt(p90)}
        </span>
      </div>
      <p className="text-meta text-muted-foreground">
        n={n} · {loLabel} / P50 / {hiLabel}
      </p>
    </div>
  );
}
