// Portfolio shell — composes Sidebar + Topbar + main container.
// WHY: one server component to own the dashboard chrome for every
// route under /portfolios/[id]/**. Keeps the per-route layout.tsx
// responsible only for data fetching + passing props in.

import type { ReactElement, ReactNode } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import type { BreadcrumbItem } from "@/components/shell/breadcrumb";

export function PortfolioShell({
  portfolioId,
  portfolioName,
  breadcrumb,
  actions,
  children,
}: {
  portfolioId: string;
  portfolioName: string;
  breadcrumb: BreadcrumbItem[];
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  // Grid columns:
  //   - single column on < md (sidebar hidden; mobile-nav in topbar)
  //   - auto + 1fr on md+ — the sidebar's own `w-16 lg:w-60` drives width
  // WHY: letting the sidebar width live on the sidebar itself (rather
  // than the grid template) keeps layout logic in one place and means
  // the grid collapses cleanly when the sidebar is hidden on mobile.
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[auto_1fr]">
      <Sidebar portfolioId={portfolioId} portfolioName={portfolioName} />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <Topbar
          breadcrumb={breadcrumb}
          actions={actions}
          portfolioId={portfolioId}
          portfolioName={portfolioName}
        />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
