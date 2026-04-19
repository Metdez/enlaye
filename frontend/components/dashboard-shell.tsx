// Dashboard shell — top header + sidebar nav + main content wrapper.
// WHY: the portfolio detail page needs to read as a real dashboard (not a
// plain article) so the sidebar and sticky header anchor the user while
// they scroll between overview, projects, and anomalies. This file is a
// pure server component: the sidebar is nothing but hash links, so we
// avoid the client bundle cost entirely. Mobile responsiveness is handled
// CSS-only by rendering both the horizontal and vertical sidebars and
// toggling visibility with Tailwind's md: breakpoint — simpler than a
// stateful hamburger and works without JS.
// See [page.tsx](../app/portfolios/[id]/page.tsx).

import type { ComponentType, ReactElement, ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  FileText,
  LayoutDashboard,
  Sparkles,
  Table2,
} from "lucide-react";
import type { Portfolio } from "@/lib/types";

// WHY: define nav items once so the desktop and mobile sidebars stay in
// lockstep. Disabled items render as spans — see SidebarItem below.
type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
  disabledTooltip?: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "#overview", icon: LayoutDashboard },
  { label: "Projects", href: "#projects", icon: Table2 },
  { label: "Anomalies", href: "#anomalies", icon: AlertTriangle },
  {
    label: "Documents",
    href: "#documents",
    icon: FileText,
    disabled: true,
    disabledTooltip: "Coming in Phase 5",
  },
  {
    label: "Models",
    href: "#models",
    icon: Sparkles,
    disabled: true,
    disabledTooltip: "Coming in Phase 4",
  },
];

// WHY: small presentational component rather than inlining the ternary twice.
// Hash-only anchors use plain <a> (per next/link guidance — Link is for
// route transitions, not same-page jumps).
function SidebarItem({
  item,
  variant,
}: {
  item: NavItem;
  variant: "desktop" | "mobile";
}): ReactElement {
  const Icon = item.icon;
  const desktopClasses =
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300";
  const mobileClasses =
    "flex shrink-0 items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300";
  const baseClasses = variant === "desktop" ? desktopClasses : mobileClasses;

  if (item.disabled) {
    return (
      <span
        className={`${baseClasses} opacity-50 cursor-not-allowed`}
        title={item.disabledTooltip}
        aria-disabled="true"
      >
        <Icon size={16} className="text-zinc-500" />
        <span>{item.label}</span>
      </span>
    );
  }

  return (
    <a
      href={item.href}
      className={`${baseClasses} hover:bg-zinc-100 dark:hover:bg-zinc-900`}
    >
      <Icon size={16} className="text-zinc-500" />
      <span>{item.label}</span>
    </a>
  );
}

export function DashboardShell({
  portfolio,
  children,
}: {
  portfolio: Portfolio;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Top header — sticky, full width, blurred background so scrolled
          content fades beneath it rather than clashing. */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/80 px-6 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            Enlaye
          </Link>
          <span className="text-zinc-400" aria-hidden="true">
            ·
          </span>
          <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
            {portfolio.name}
          </span>
        </div>
        {/* WHY: counts live in the header so they stay visible as the user
            scrolls through the body. Hidden on mobile to keep the bar
            uncrowded; primary identity (name) takes priority there. */}
        <div className="hidden text-xs tabular-nums text-zinc-500 sm:block">
          <span>{portfolio.row_count}</span> rows ·{" "}
          <span>{portfolio.anomaly_count}</span> anomalies
        </div>
      </header>

      {/* Outer grid: single column on mobile, sidebar + main on md+. */}
      <div className="md:grid md:grid-cols-[220px_1fr]">
        {/* Mobile sidebar — horizontal scrollable pill row. Rendered in the
            DOM alongside the desktop variant and toggled via md:hidden so
            we don't need a client component for breakpoint logic. */}
        <nav
          aria-label="Portfolio sections"
          className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 md:hidden"
        >
          {NAV_ITEMS.map((item) => (
            <SidebarItem key={item.label} item={item} variant="mobile" />
          ))}
        </nav>

        {/* Desktop sidebar — sticky vertical column. top-14 matches the
            56px header height so the sidebar pins directly below it. */}
        <nav
          aria-label="Portfolio sections"
          className="hidden border-r border-zinc-200 p-3 dark:border-zinc-800 md:sticky md:top-14 md:block md:h-[calc(100vh-56px)] md:space-y-0.5"
        >
          {NAV_ITEMS.map((item) => (
            <SidebarItem key={item.label} item={item} variant="desktop" />
          ))}
        </nav>

        <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

// Reusable empty-state card for "no documents yet" / "no model runs yet"
// placeholders. Kept in this file because it's a layout primitive that
// pairs with DashboardShell — not big enough to deserve its own file yet.
export function EmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}): ReactElement {
  return (
    <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
      {Icon ? (
        <div className="mb-3 flex justify-center">
          <Icon size={40} className="text-zinc-400" />
        </div>
      ) : null}
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {title}
      </p>
      {description ? (
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      ) : null}
    </div>
  );
}
