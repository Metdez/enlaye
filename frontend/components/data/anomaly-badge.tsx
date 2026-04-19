import { Clock, DollarSign, Gavel, HardHat, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type AnomalyCategory =
  | "cost_overrun"
  | "schedule_delay"
  | "safety"
  | "disputes";

// WHY: Tailwind 4's JIT cannot discover classes built at runtime, so we
// enumerate the exact class strings per category here.
const ANOMALY_STYLES: Record<
  AnomalyCategory,
  { bg: string; text: string; border: string; icon: LucideIcon; label: string }
> = {
  cost_overrun: {
    bg: "bg-rose-500/10",
    text: "text-rose-600 dark:text-rose-400",
    border: "border-rose-500/20",
    icon: DollarSign,
    label: "Cost overrun",
  },
  schedule_delay: {
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/20",
    icon: Clock,
    label: "Schedule delay",
  },
  safety: {
    bg: "bg-orange-500/10",
    text: "text-orange-600 dark:text-orange-400",
    border: "border-orange-500/20",
    icon: HardHat,
    label: "Safety",
  },
  disputes: {
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    border: "border-violet-500/20",
    icon: Gavel,
    label: "Dispute",
  },
};

type AnomalyBadgeProps = {
  category: AnomalyCategory;
  label?: string;
  className?: string;
};

/** Pill badge tinted per anomaly category: icon + short label. */
export function AnomalyBadge({
  category,
  label,
  className,
}: AnomalyBadgeProps) {
  const style = ANOMALY_STYLES[category];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        style.bg,
        style.text,
        style.border,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label ?? style.label}
    </span>
  );
}
