// Loading skeleton for the Overview route.
// WHY: the Overview is the most data-heavy page (portfolio + all projects);
// mirroring its rough layout (section header, cleaning report bar, 4 KPIs,
// 2 chart cards, 1 donut) prevents a layout jump when real content resolves.

import type { ReactElement } from "react";

import {
  ChartSkeleton,
  KpiSkeleton,
} from "@/components/state/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortfolioOverviewLoading(): ReactElement {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8"
      role="status"
      aria-live="polite"
      aria-label="Loading portfolio overview"
    >
      <span className="sr-only">Loading portfolio…</span>

      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-80" />
      </div>

      <Skeleton className="h-14 w-full rounded-xl" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>

      <ChartSkeleton height={260} />
    </div>
  );
}
