// Desktop sidebar — 240px wide on ≥ lg, 64px icon-only between md and lg.
// WHY: renders two variants in markup and toggles with CSS so we avoid
// any runtime layout state. Fully server-component; nav items + theme
// toggle are the only client leaves.
//
// Structure (top → bottom):
//   1. Brand wordmark
//   2. Portfolio switcher (stub, read-only)
//   3. Nav list
//   4. Spacer
//   5. Account card + theme toggle

import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import type { ReactElement } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PORTFOLIO_NAV_ITEMS } from "@/components/shell/nav-items";
import { SidebarNavItem } from "@/components/shell/sidebar-nav-item";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

type SidebarProps = {
  portfolioId: string;
  portfolioName: string;
  /** If true, renders the expanded 240px variant at every size. Used by
   *  the mobile sheet. Defaults to false — desktop uses responsive
   *  collapse (expanded at lg, icon-only below). */
  forceExpanded?: boolean;
};

function Brand({ collapsed }: { collapsed: boolean }): ReactElement {
  // WHY: wordmark doubles as a "home" affordance. Link back to root
  // lets users escape the portfolio without hunting through nav.
  return (
    <div className="flex h-12 items-center px-3">
      <Link
        href="/"
        className={cn(
          "flex h-9 items-center rounded-md px-1 text-sm font-semibold tracking-tight text-foreground uppercase",
          "outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
          collapsed && "w-full justify-center px-0",
        )}
        aria-label="Enlaye home"
      >
        {collapsed ? (
          <span aria-hidden="true" className="text-base">
            E
          </span>
        ) : (
          <span>Enlaye</span>
        )}
      </Link>
    </div>
  );
}

function PortfolioSwitcher({
  portfolioName,
  collapsed,
}: {
  portfolioName: string;
  collapsed: boolean;
}): ReactElement {
  // NOTE: stubbed — future iteration will turn this into a dropdown
  // that lists every portfolio the user can access. For now it renders
  // as a disabled-looking button-shaped row showing the current name,
  // so the visual grammar is already in place when we wire it up.
  const row = (
    <div
      role="button"
      aria-disabled="true"
      tabIndex={-1}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2.5 text-left text-sm text-foreground",
        "cursor-default select-none",
        collapsed && "justify-center px-0",
      )}
    >
      <Avatar size="sm" className="shrink-0">
        <AvatarFallback className="text-[10px] font-medium text-muted-foreground">
          {portfolioName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate font-medium">
            {portfolioName}
          </span>
          <ChevronsUpDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div className="px-3">
        <Tooltip>
          <TooltipTrigger render={row} />
          <TooltipContent side="right" sideOffset={8}>
            {portfolioName}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return <div className="px-3">{row}</div>;
}

function AccountCard({ collapsed }: { collapsed: boolean }): ReactElement {
  // WHY: the account affordance anchors the bottom of the rail. Demo
  // copy for now; will read from auth once we wire up sign-in.
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2",
        collapsed && "justify-center px-0",
      )}
    >
      <Avatar size="sm" className="shrink-0">
        <AvatarFallback className="text-[11px] font-medium">D</AvatarFallback>
      </Avatar>
      {collapsed ? null : (
        <>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-foreground">
              Demo analyst
            </p>
            <p className="truncate text-xs text-muted-foreground">Read-only</p>
          </div>
          <ThemeToggle />
        </>
      )}
    </div>
  );
}

export function Sidebar({
  portfolioId,
  portfolioName,
  forceExpanded = false,
}: SidebarProps): ReactElement {
  // `collapsed` in this file is a *presentational* prop passed to each
  // child. The actual switch is driven by responsive variants below —
  // we render one shell per breakpoint.
  if (forceExpanded) {
    // Mobile Sheet path: always expanded, full-width inside the sheet.
    return (
      <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
        <Brand collapsed={false} />
        <div className="border-b border-sidebar-border" />
        <div className="py-3">
          <PortfolioSwitcher
            portfolioName={portfolioName}
            collapsed={false}
          />
        </div>
        <div className="border-b border-sidebar-border" />
        <nav aria-label="Portfolio sections" className="flex-1 p-2">
          <ul className="space-y-0.5">
            {PORTFOLIO_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <SidebarNavItem
                    label={item.label}
                    segment={item.segment}
                    href={item.href(portfolioId)}
                    icon={<Icon className="size-4 shrink-0" aria-hidden="true" />}
                    collapsed={false}
                  />
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-sidebar-border p-2">
          <AccountCard collapsed={false} />
        </div>
      </div>
    );
  }

  // Desktop responsive rail:
  //   - 64px wide at md (icon-only)
  //   - 240px wide at lg+ (labelled)
  // The `group/sidebar` + `lg:` variants drive per-child collapse.
  return (
    <aside
      data-slot="sidebar"
      aria-label="Primary"
      className={cn(
        "group/sidebar hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex",
        "w-16 lg:w-60",
      )}
    >
      {/* Expanded view (lg+) — rendered once with `hidden lg:flex` */}
      <div className="hidden h-full flex-col lg:flex">
        <Brand collapsed={false} />
        <div className="border-b border-sidebar-border" />
        <div className="py-3">
          <PortfolioSwitcher
            portfolioName={portfolioName}
            collapsed={false}
          />
        </div>
        <div className="border-b border-sidebar-border" />
        <nav aria-label="Portfolio sections" className="flex-1 p-2">
          <ul className="space-y-0.5">
            {PORTFOLIO_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <SidebarNavItem
                    label={item.label}
                    segment={item.segment}
                    href={item.href(portfolioId)}
                    icon={<Icon className="size-4 shrink-0" aria-hidden="true" />}
                    collapsed={false}
                  />
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-sidebar-border p-2">
          <AccountCard collapsed={false} />
        </div>
      </div>

      {/* Collapsed view (md only) — rendered with `flex lg:hidden`. */}
      <div className="flex h-full flex-col lg:hidden">
        <Brand collapsed />
        <div className="border-b border-sidebar-border" />
        <div className="py-3">
          <PortfolioSwitcher portfolioName={portfolioName} collapsed />
        </div>
        <div className="border-b border-sidebar-border" />
        <nav aria-label="Portfolio sections" className="flex-1 p-2">
          <ul className="space-y-0.5">
            {PORTFOLIO_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <SidebarNavItem
                    label={item.label}
                    segment={item.segment}
                    href={item.href(portfolioId)}
                    icon={<Icon className="size-4 shrink-0" aria-hidden="true" />}
                    collapsed
                  />
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-sidebar-border p-2">
          <AccountCard collapsed />
        </div>
      </div>
    </aside>
  );
}
