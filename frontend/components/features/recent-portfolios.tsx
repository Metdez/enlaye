// Recent-portfolios list for the landing page.
// WHY: server component — it's a read-only list rendered inline with the
// landing page's server-fetched data. Tight vertical row list, hover state,
// right-chevron affordance pointing at the portfolio detail route.

import type { ReactElement } from "react";
import Link from "next/link";
import { ChevronRight, FolderClosed, Upload } from "lucide-react";

import { TabularNumber } from "@/components/data/tabular-number";
import { EmptyState } from "@/components/state/empty-state";
import { formatRelative } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

export function RecentPortfolios({
  portfolios,
}: {
  portfolios: Portfolio[];
}): ReactElement {
  if (portfolios.length === 0) {
    return (
      <EmptyState
        icon={Upload}
        title="No portfolios yet"
        description="Upload your first portfolio to get started."
      />
    );
  }

  return (
    <ul
      className="divide-y divide-border rounded-lg border border-border bg-card"
      aria-label="Recent portfolios"
    >
      {portfolios.map((p) => (
        <li key={p.id}>
          <Link
            href={`/portfolios/${p.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <FolderClosed className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-h3 truncate text-foreground" title={p.name}>
                {p.name}
              </p>
              <p className="text-meta mt-0.5 tabular-nums">
                {formatRelative(p.created_at)} ·{" "}
                <TabularNumber value={p.row_count} /> rows ·{" "}
                <TabularNumber value={p.anomaly_count} /> anomalies
              </p>
            </div>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
