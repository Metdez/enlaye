import { AlertTriangle, RotateCcw, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  onRetry: () => void;
  retryLabel?: string;
  className?: string;
};

/** Centered error placeholder with mandatory retry CTA. */
export function ErrorState({
  icon: Icon = AlertTriangle,
  title,
  description,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-h3 text-foreground">{title}</p>
        {description ? (
          <p className="text-body max-w-prose text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw aria-hidden />
        {retryLabel}
      </Button>
    </div>
  );
}
