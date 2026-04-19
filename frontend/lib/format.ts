// Locale-aware formatters for numbers and dates.
// WHY: centralizing these keeps tabular display consistent and
// guarantees we reach for the same short forms everywhere.

const currencyCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat("en-US");

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", {
  numeric: "auto",
});

/** USD compact currency, e.g. `$2.4M`. */
export function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return currencyCompact.format(n);
}

/** Percentage with fixed digits. Input is a raw percentage (e.g. 12.5 → "12.5%"). */
export function formatPercent(
  n: number | null | undefined,
  digits: number = 1,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Locale thousands grouping, e.g. `1,234,567`. */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return numberFormatter.format(n);
}

/** Medium date, e.g. `Apr 19, 2026`. */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter.format(d);
}

/** Relative time; falls back to {@link formatDate} past 30 days. */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";

  const diffMs = d.getTime() - Date.now();
  const absDays = Math.abs(diffMs) / (1000 * 60 * 60 * 24);

  if (absDays > 30) return formatDate(d);

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
    { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
    { unit: "week", ms: 1000 * 60 * 60 * 24 * 7 },
    { unit: "day", ms: 1000 * 60 * 60 * 24 },
    { unit: "hour", ms: 1000 * 60 * 60 },
    { unit: "minute", ms: 1000 * 60 },
    { unit: "second", ms: 1000 },
  ];

  for (const { unit, ms } of units) {
    if (Math.abs(diffMs) >= ms || unit === "second") {
      return relativeFormatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return formatDate(d);
}
