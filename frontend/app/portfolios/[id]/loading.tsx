// Skeleton shown while the portfolio detail page's server component awaits
// its parallel Supabase queries. Next.js wires this in automatically — no
// import needed in page.tsx.
// WHY: a static skeleton beats a blank screen on slow networks. Mirrors the
// rough shape of the rendered page (header, summary tiles, table) so the
// layout doesn't jump when real content swaps in.

import type { ReactElement } from "react";

function Block({ className }: { className: string }): ReactElement {
  // WHY: animate-pulse is Tailwind's built-in shimmer; no extra dep needed.
  // bg-zinc-200/dark:bg-zinc-800 keeps contrast subtle in both themes.
  return (
    <div
      className={`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800 ${className}`}
      aria-hidden="true"
    />
  );
}

export default function PortfolioLoading(): ReactElement {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-10 px-6 py-8"
      role="status"
      aria-live="polite"
      aria-label="Loading portfolio"
    >
      <span className="sr-only">Loading portfolio…</span>

      <div className="space-y-3">
        <Block className="h-7 w-1/2" />
        <Block className="h-4 w-1/3" />
      </div>

      <Block className="h-16 w-full" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="h-24" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block className="h-64" />
        <Block className="h-64" />
      </div>

      <Block className="h-96 w-full" />
    </div>
  );
}
