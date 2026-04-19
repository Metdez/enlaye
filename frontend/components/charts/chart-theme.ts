// Recharts theme tokens wired to OKLCH vars in globals.css.
// WHY: charts should track theme (light/dark) automatically; referencing
// CSS variables rather than hex literals means no remount on theme change.

/** Palette keyed to semantic roles for charts. */
export const chartColors = {
  primary: "var(--color-primary)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-destructive)",
  neutral: "var(--color-muted-foreground)",
  // WHY: "leaky" = naive model (amber), "actionable" = pre-construction model (blue).
  // This naming echoes the two-model comparison feature.
  leaky: "var(--color-warning)",
  actionable: "var(--color-primary)",
} as const;

export type ChartColorKey = keyof typeof chartColors;

/** Ordered fallback palette for anonymous series. */
export const chartSeriesPalette = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

/** Dashed low-contrast grid per design rules. */
export const gridStroke = {
  stroke: "var(--color-border)",
  strokeOpacity: 0.5,
  strokeDasharray: "3 3",
} as const;

/** Axis tick styling — 11px, muted. */
export const axisTick = {
  fill: "var(--color-muted-foreground)",
  fontSize: 11,
} as const;

/** Shared tooltip chrome so Recharts matches the app's cards. */
export const tooltipStyle = {
  contentStyle: {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    color: "var(--color-popover-foreground)",
    fontSize: 12,
    padding: "8px 10px",
    boxShadow:
      "0 8px 24px -8px rgb(0 0 0 / 0.12), 0 2px 6px -2px rgb(0 0 0 / 0.06)",
  },
  labelStyle: {
    color: "var(--color-muted-foreground)",
    fontSize: 11,
    marginBottom: 2,
  },
  itemStyle: {
    color: "var(--color-popover-foreground)",
    fontSize: 12,
  },
  cursor: { fill: "var(--color-muted)", opacity: 0.4 },
} as const;
