"use client";

import { useState } from "react";
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  axisTick,
  gridStroke,
  tooltipStyle,
} from "@/components/charts/chart-theme";

export type BarSeries = {
  key: string;
  color: string;
  label?: string;
};

type BarChartProps<T extends Record<string, unknown>> = {
  data: T[];
  xKey: keyof T & string;
  bars: BarSeries[];
  height?: number;
  horizontal?: boolean;
  className?: string;
};

/** Recharts bar chart with dim-on-hover series emphasis and themed axes. */
export function BarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  bars,
  height = 280,
  horizontal = false,
  className,
}: BarChartProps<T>) {
  const [hovered, setHovered] = useState<string | null>(null);
  const showLegend = bars.length > 1;

  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
          onMouseLeave={() => setHovered(null)}
        >
          <CartesianGrid
            {...gridStroke}
            horizontal={!horizontal}
            vertical={horizontal}
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tick={axisTick}
                stroke="var(--color-border)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey={xKey as string}
                tick={axisTick}
                stroke="var(--color-border)"
                tickLine={false}
                axisLine={false}
                width={96}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={xKey as string}
                tick={axisTick}
                stroke="var(--color-border)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={axisTick}
                stroke="var(--color-border)"
                tickLine={false}
                axisLine={false}
              />
            </>
          )}
          <Tooltip {...tooltipStyle} />
          {showLegend ? (
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconSize={10}
              iconType="circle"
              onMouseEnter={(e) =>
                setHovered((e as unknown as { dataKey: string }).dataKey)
              }
              onMouseLeave={() => setHovered(null)}
            />
          ) : null}
          {bars.map((b) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.label ?? b.key}
              fill={b.color}
              radius={[4, 4, 0, 0]}
              fillOpacity={hovered && hovered !== b.key ? 0.25 : 1}
              onMouseEnter={() => setHovered(b.key)}
              isAnimationActive={false}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}
