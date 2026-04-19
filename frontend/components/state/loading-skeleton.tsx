import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type BaseProps = { className?: string };

/** KPI tile placeholder: small label line + large value line. */
export function KpiSkeleton({ className }: BaseProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

type TableSkeletonProps = BaseProps & { rows?: number; columns?: number };

/** Table placeholder: header row + N body rows, M columns. */
export function TableSkeleton({
  className,
  rows = 6,
  columns = 5,
}: TableSkeletonProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <div
        className="grid gap-3 border-b border-border bg-muted/40 px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 w-24" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={`r-${r}`}
            className="grid gap-3 px-4 py-3"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={`r-${r}-c-${c}`} className="h-3.5 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

type ChartSkeletonProps = BaseProps & { height?: number };

/** Chart placeholder: title bar + rectangular plot area. */
export function ChartSkeleton({ className, height = 280 }: ChartSkeletonProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="w-full rounded-md" style={{ height }} />
    </div>
  );
}

/** Generic card placeholder: stacked lines + a footer line. */
export function CardSkeleton({ className }: BaseProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

type TextSkeletonProps = BaseProps & { lines?: number };

/** Multi-line text placeholder. */
export function TextSkeleton({ className, lines = 3 }: TextSkeletonProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          // WHY: last line is shorter for a natural paragraph rag.
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}
