// Portfolio overview: KPI tiles + charts.
// WHY: server component. All aggregations happen inline — the rows are
// already in memory for this page and re-deriving server-side avoids a
// round trip for a purely presentational view. The chart leaves are
// client-only (Recharts needs DOM APIs) and live in @/components/charts.

import type { ReactElement } from "react";
import { BarChart3 } from "lucide-react";

import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { chartColors } from "@/components/charts/chart-theme";
import { KpiTile } from "@/components/data/kpi-tile";
import { EmptyState } from "@/components/state/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { Portfolio, ProjectRow } from "@/lib/types";

type BarDatum = { name: string; value: number };
type DonutDatum = { name: string; value: number };

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function groupMean(
  rows: ProjectRow[],
  keyField: "project_type",
  valueField: "delay_days" | "cost_overrun_pct",
): BarDatum[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const key = row[keyField];
    const value = row[valueField];
    if (!key || key.length === 0) continue;
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(value);
    else buckets.set(key, [value]);
  }
  const out: BarDatum[] = [];
  for (const [type, values] of buckets) {
    const m = mean(values);
    if (m !== null) out.push({ name: type, value: Number(m.toFixed(2)) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
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
  for (const [region, value] of buckets) out.push({ name: region, value });
  out.sort((a, b) => b.value - a.value);
  return out;
}

export function PortfolioSummary({
  portfolio: _portfolio,
  projects,
}: {
  portfolio: Portfolio;
  projects: ProjectRow[];
}): ReactElement {
  void _portfolio;

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No project data to summarize"
        description="Charts and totals will appear once a CSV is ingested."
      />
    );
  }

  let totalContract = 0;
  let completed = 0;
  const delays: number[] = [];
  for (const row of projects) {
    if (row.contract_value_usd !== null && !Number.isNaN(row.contract_value_usd)) {
      totalContract += row.contract_value_usd;
    }
    if (row.final_status === "Completed") completed += 1;
    if (row.delay_days !== null && !Number.isNaN(row.delay_days)) {
      delays.push(row.delay_days);
    }
  }
  const avgDelay = mean(delays);

  const delayByType = groupMean(projects, "project_type", "delay_days");
  const overrunByType = groupMean(projects, "project_type", "cost_overrun_pct");
  const byRegion = groupCount(projects);

  // Horizontal bar layout once the x-axis gets crowded — otherwise labels
  // collide and we lose the scan-across read.
  const delayHorizontal = delayByType.length > 4;
  const overrunHorizontal = overrunByType.length > 4;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile
          label="Total contract value"
          value={formatCurrency(totalContract)}
        />
        <KpiTile label="Projects" value={projects.length} />
        <KpiTile label="Completed" value={completed} />
        <KpiTile
          label="Avg delay (days)"
          value={avgDelay == null ? "—" : avgDelay.toFixed(1)}
          mono
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Avg delay by project type</CardTitle>
          </CardHeader>
          <CardContent>
            {delayByType.length === 0 ? (
              <p className="text-body text-muted-foreground">
                Not enough data to chart.
              </p>
            ) : (
              <BarChart
                data={delayByType}
                xKey="name"
                bars={[
                  {
                    key: "value",
                    color: chartColors.primary,
                    label: "Delay (days)",
                  },
                ]}
                horizontal={delayHorizontal}
                height={260}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Avg cost overrun by type</CardTitle>
          </CardHeader>
          <CardContent>
            {overrunByType.length === 0 ? (
              <p className="text-body text-muted-foreground">
                Not enough data to chart.
              </p>
            ) : (
              <BarChart
                data={overrunByType}
                xKey="name"
                bars={[
                  {
                    key: "value",
                    color: chartColors.primary,
                    label: "Overrun %",
                  },
                ]}
                horizontal={overrunHorizontal}
                height={260}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projects by region</CardTitle>
        </CardHeader>
        <CardContent>
          {byRegion.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Not enough data to chart.
            </p>
          ) : (
            <DonutChart
              data={byRegion}
              centerLabel="Projects"
              centerValue={projects.length}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
