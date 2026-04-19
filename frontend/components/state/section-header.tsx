import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

/** Section heading: h2 title, muted subtitle, right-aligned actions slot. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 pb-4 md:flex-row md:items-end md:justify-between md:gap-6",
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-h2 text-foreground">{title}</h2>
        {description ? (
          <p className="text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 md:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
