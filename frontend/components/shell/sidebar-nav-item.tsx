"use client";

// Sidebar nav item — single link row with active-state awareness.
// WHY: lives in its own client component because it needs
// `useSelectedLayoutSegment()` to compare against its target segment.
// Keeping the hook at the leaf keeps the surrounding sidebar shell as
// light a server component as possible.

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactElement, ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// WHY: props are primitives + a pre-rendered icon node, not the raw
// NavItem. The parent is a server component and NavItem contains a
// `href: (id) => string` function plus a `LucideIcon` component
// reference — neither can cross the RSC/client serialization boundary.
export function SidebarNavItem({
  label,
  segment,
  href,
  icon,
  collapsed = false,
}: {
  label: string;
  segment: string | null;
  href: string;
  icon: ReactNode;
  collapsed?: boolean;
}): ReactElement {
  // NOTE: `useSelectedLayoutSegment()` returns `null` for the index
  // route (i.e. /portfolios/[id]) — which matches the Overview item's
  // `segment: null`. A strict `===` comparison handles both cases.
  const currentSegment = useSelectedLayoutSegment();
  const isActive = currentSegment === segment;

  const link = (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        // base row — 36px tall, rounded md, horizontal padding 12px,
        // icon↔label gap 12px per spec.
        "group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        // active vs. idle
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        // icon-only collapsed mode: center, remove padding
        collapsed && "justify-center px-0",
      )}
    >
      {/* Active left indicator bar — 2px wide, primary accent. */}
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-primary"
        />
      ) : null}
      {icon}
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  );

  // Collapsed mode shows a tooltip with the label so the affordance
  // is preserved without text. Expanded mode skips the tooltip — the
  // label is already right there.
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
