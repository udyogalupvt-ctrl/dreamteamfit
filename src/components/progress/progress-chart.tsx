import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatMetric, metricInfo, progressSeries, type BodyMetric } from "@/lib/body-progress";
import type { BodyEntry } from "@/types/models";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-05" → "5 Oct". */
const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** One number over time (loaded on demand: recharts is big and only this screen needs it). */
export default function ProgressChart({
  entries,
  metric,
}: {
  entries: BodyEntry[];
  metric: BodyMetric;
}) {
  const info = metricInfo(metric);
  const data = useMemo(
    () => progressSeries(entries, metric).map((p) => ({ ...p, label: shortDay(p.date) })),
    [entries, metric],
  );
  const calm = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const config = { value: { label: info.label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const axis = { tickLine: false, axisLine: false } as const;
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full sm:h-60">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={16} />
        <YAxis
          {...axis}
          width={40}
          domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]}
          allowDecimals={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{info.label}</span>
                  <span className="font-semibold tabular-nums">
                    {formatMetric(Number(value), metric)}
                  </span>
                </div>
              )}
            />
          }
        />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2.5}
          dot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: "var(--color-value)" }}
          activeDot={{ r: 6 }}
          isAnimationActive={!calm}
        />
      </LineChart>
    </ChartContainer>
  );
}
