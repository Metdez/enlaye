"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  chartSeriesPalette,
  tooltipStyle,
} from "@/components/charts/chart-theme";
import { cn } from "@/lib/utils";

export type DonutDatum = {
  name: string;
  value: number;
  color?: string;
};

type DonutChartProps = {
  data: DonutDatum[];
  height?: number;
  centerLabel?: string;
  centerValue?: string | number;
  className?: string;
};

/** Recharts donut (innerRadius 55%) with optional center label/value. */
export function DonutChart({
  data,
  height = 260,
  centerLabel,
  centerValue,
  className,
}: DonutChartProps) {
  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip {...tooltipStyle} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            stroke="var(--color-card)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell
                key={d.name}
                fill={
                  d.color ??
                  chartSeriesPalette[i % chartSeriesPalette.length]
                }
              />
            ))}
          </Pie>
          <Legend
            layout="horizontal"
            align="center"
            verticalAlign="bottom"
            iconSize={10}
            iconType="circle"
            wrapperStyle={{ fontSize: 12 }}
            // WHY: at md+ we snap the legend to the right side via CSS wrapper
            // in parent; Recharts can't do responsive legend layout on its own.
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue != null || centerLabel ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue != null ? (
            <span className="text-h1 font-semibold tabular-nums text-foreground">
              {centerValue}
            </span>
          ) : null}
          {centerLabel ? (
            <span className="text-meta uppercase tracking-wide">
              {centerLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
