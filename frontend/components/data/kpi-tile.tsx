import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "danger";

type KpiTileProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  mono?: boolean;
  className?: string;
};

const TONE_CLASS: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

/** Single-metric card: small label above, big value below, optional hint. */
export function KpiTile({
  label,
  value,
  hint,
  tone = "default",
  mono = false,
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border bg-card p-4 transition-colors duration-150",
        className,
      )}
    >
      <p className="text-meta uppercase tracking-wide">{label}</p>
      <p
        className={cn(
          "text-h1 text-right tabular-nums",
          mono && "font-mono",
          TONE_CLASS[tone],
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-meta text-right text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
