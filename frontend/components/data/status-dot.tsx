import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

type StatusDotProps = {
  tone: StatusTone;
  label?: string;
  className?: string;
};

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
};

/** 8px colored dot with an optional label for inline status cues. */
export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-body", className)}
    >
      <span
        aria-hidden
        className={cn("inline-block size-2 rounded-full", TONE_CLASS[tone])}
      />
      {label ? (
        <>
          <span className="sr-only">{`${tone}: `}</span>
          <span className="text-foreground">{label}</span>
        </>
      ) : (
        <span className="sr-only">{tone}</span>
      )}
    </span>
  );
}
