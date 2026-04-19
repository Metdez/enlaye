"use client";

// High-level portfolio stat tiles + Recharts visualizations for the
// portfolio detail page.
// WHY: Recharts renders via DOM APIs (SVG measurement, ResponsiveContainer
// uses ResizeObserver), so this must be a client component. The parent page
// stays a server component and hands us already-fetched rows as plain props.
// WHY: all aggregations happen inline with useMemo rather than in a server
// helper — the dataset is already in memory on this page and re-deriving on
// the server would mean a round trip for a view that's purely presentational.

import { useMemo, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Portfolio, ProjectRow } from "@/lib/types";

// WHY: compact currency formatter instantiated once at module scope to avoid
// allocating an Intl.NumberFormat on every render. Matches projects-table.tsx.
const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// WHY: fixed palette keeps region colors deterministic across renders. Cycled
// modulo length when there are more regions than colors. Expanded to 10 entries
// so portfolios with up to 10 distinct regions get unique slice colors before
// the legend starts repeating.
const DONUT_PALETTE = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#ef4444",
  "#14b8a6",
  "#a855f7",
  "#84cc16",
];

type BarDatum = { type: string; value: number };
type DonutDatum = { region: string; value: number };

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

// WHY: group-by helper kept local — pulling in a lodash dependency for three
// call sites isn't worth the bundle cost.
function groupMean(
  rows: ProjectRow[],
  keyField: "project_type",
  valueField: "delay_days" | "cost_overrun_pct",
): BarDatum[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const key = row[keyField];
    const value = row[valueField];
    // NOTE: skip nulls and empty strings — a bar labelled "" is noise, not data.
    if (!key || key.length === 0) continue;
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(value);
    else buckets.set(key, [value]);
  }
  const out: BarDatum[] = [];
  for (const [type, values] of buckets) {
    const m = mean(values);
    if (m !== null) out.push({ type, value: Number(m.toFixed(2)) });
  }
  // WHY: alphabetical sort keeps the x-axis stable as data changes; otherwise
  // Map iteration order (insertion) makes the chart jump around on re-ingest.
  out.sort((a, b) => a.type.localeCompare(b.type));
  return out;
}

function groupCount(rows: ProjectRow[]): DonutDatum[] {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const region = row.region;
    if (!region || region.length === 0) continue;
    buckets.set(region, (buckets.get(region) ?? 0) + 1);
  }
  const out: DonutDatum[] = [];
  for (const [region, value] of buckets) out.push({ region, value });
  out.sort((a, b) => b.value - a.value);
  return out;
}

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyChartBody(): ReactElement {
  return (
    <p className="text-sm text-zinc-500">Not enough data to chart.</p>
  );
}

export function PortfolioSummary({
  portfolio: _portfolio,
  projects,
}: {
  portfolio: Portfolio;
  projects: ProjectRow[];
}): ReactElement {
  // NOTE: portfolio is part of the public API (future sections may render
  // its name, created_at, etc.) but unused today — prefix with _ to silence
  // no-unused-vars without breaking the contract.
  void _portfolio;

  const stats = useMemo(() => {
    let totalContract = 0;
    let completed = 0;
    let inProgress = 0;
    const delays: number[] = [];
    for (const row of projects) {
      if (row.contract_value_usd !== null && !Number.isNaN(row.contract_value_usd)) {
        totalContract += row.contract_value_usd;
      }
      if (row.final_status === "Completed") completed += 1;
      if (row.final_status === "In Progress") inProgress += 1;
      if (row.delay_days !== null && !Number.isNaN(row.delay_days)) {
        delays.push(row.delay_days);
      }
    }
    const avgDelay = mean(delays);
    return {
      totalContract,
      completed,
      inProgress,
      avgDelay,
    };
  }, [projects]);

  const delayByType = useMemo(
    () => groupMean(projects, "project_type", "delay_days"),
    [projects],
  );
  const overrunByType = useMemo(
    () => groupMean(projects, "project_type", "cost_overrun_pct"),
    [projects],
  );
  const byRegion = useMemo(() => groupCount(projects), [projects]);

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No projects in this portfolio yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total contract value"
          value={compactUsd.format(stats.totalContract)}
        />
        <StatTile label="Completed" value={stats.completed.toLocaleString("en-US")} />
        <StatTile
          label="In progress"
          value={stats.inProgress.toLocaleString("en-US")}
        />
        <StatTile
          label="Avg delay (days)"
          value={stats.avgDelay === null ? "—" : stats.avgDelay.toFixed(1)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Mean delay days by project type">
          {delayByType.length === 0 ? (
            <EmptyChartBody />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={delayByType}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="type"
                  tick={{ fontSize: 12 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Mean cost overrun % by project type">
          {overrunByType.length === 0 ? (
            <EmptyChartBody />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={overrunByType}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="type"
                  tick={{ fontSize: 12 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar
                  dataKey="value"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Projects by region">
          {byRegion.length === 0 ? (
            <EmptyChartBody />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Tooltip />
                <Legend verticalAlign="bottom" height={24} />
                <Pie
                  data={byRegion}
                  dataKey="value"
                  nameKey="region"
                  innerRadius={50}
                  outerRadius={80}
                >
                  {byRegion.map((slice, idx) => (
                    <Cell
                      key={slice.region}
                      fill={DONUT_PALETTE[idx % DONUT_PALETTE.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
