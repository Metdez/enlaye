// Topbar — sticky 56px bar with mobile-nav trigger, breadcrumb, and
// an optional right-side actions slot.
// WHY: server component. The only interactive piece (MobileNav) is a
// client leaf that manages its own sheet state.

import type { ReactElement, ReactNode } from "react";

import { Breadcrumb, type BreadcrumbItem } from "@/components/shell/breadcrumb";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

export function Topbar({
  breadcrumb,
  actions,
  portfolioId,
  portfolioName,
  className,
}: {
  breadcrumb: BreadcrumbItem[];
  actions?: ReactNode;
  portfolioId: string;
  portfolioName: string;
  className?: string;
}): ReactElement {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6",
        className,
      )}
    >
      <MobileNav portfolioId={portfolioId} portfolioName={portfolioName} />
      <div className="min-w-0 flex-1">
        <Breadcrumb items={breadcrumb} />
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {/* WHY: theme toggle is duplicated here (also in the sidebar
            account card) so it's reachable in the icon-only rail or
            when the sidebar is behind the mobile sheet. It's the kind
            of control users want one tap away regardless of layout. */}
        <div className="md:hidden">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
