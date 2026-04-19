// Breadcrumb — inline text trail with ChevronRight separators.
// WHY: pure server component; no interactivity. Last item is emphasised
// as the current location; earlier items are anchor links.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumb({
  items,
}: {
  items: BreadcrumbItem[];
}): ReactElement | null {
  if (items.length === 0) return null;

  const lastIndex = items.length - 1;
  // WHY: on narrow viewports we only surface the final two items so the
  // topbar stays legible. The rest are hidden via `hidden md:inline` —
  // separators track the same visibility so we don't leave dangling
  // chevrons on mobile.
  const mobileThreshold = Math.max(0, lastIndex - 1);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const isLast = index === lastIndex;
          const hideOnMobile = index < mobileThreshold;

          return (
            <li
              key={`${item.label}-${index}`}
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                hideOnMobile && "hidden md:flex",
              )}
            >
              {index > 0 ? (
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground",
                    hideOnMobile && "hidden md:inline",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "truncate",
                    isLast
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="truncate rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
