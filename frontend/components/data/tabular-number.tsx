import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";

type TabularNumberProps = {
  value: number | null | undefined;
  formatter?: (n: number) => string;
  currency?: boolean;
  className?: string;
};

/** Right-aligned mono-numeric cell; formats as USD compact when `currency`. */
export function TabularNumber({
  value,
  formatter,
  currency,
  className,
}: TabularNumberProps) {
  const rendered =
    value == null || !Number.isFinite(value)
      ? "—"
      : formatter
        ? formatter(value)
        : currency
          ? formatCurrency(value)
          : formatNumber(value);

  return (
    <span
      className={cn(
        "inline-block text-right font-mono tabular-nums",
        className,
      )}
    >
      {rendered}
    </span>
  );
}
