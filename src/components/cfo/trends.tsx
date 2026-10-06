import { useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatCount,
  formatPercent,
  formatRupees,
  formatSignedCount,
  NOT_ENOUGH_DATA,
} from "@/lib/cfo/money";
import type { CfoMonth, CfoSnapshot } from "@/lib/cfo/types";
import { cn } from "@/lib/utils";
import { monthShort } from "./cfo-format";

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const axisMoney = (v: number) => (v === 0 ? "0" : `₹${compact.format(v)}`);

const monthLabel = (m: CfoMonth) => `${monthShort(m.key)}${m.partial ? "*" : ""}`;

function useCalm() {
  return useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function ChartCard({
  title,
  subLabel,
  summary,
  legend,
  chart,
  table,
}: {
  title: string;
  subLabel: string;
  summary: string;
  legend: { label: string; color: string }[];
  chart: ReactNode;
  table: ReactNode;
}) {
  return (
    <figure className="surface-card space-y-3 p-4 sm:p-5">
      <figcaption>
        <h3 className="text-card-title">{title}</h3>
        <p className="text-meta mt-0.5">{subLabel}</p>
      </figcaption>
      <Legend items={legend} />
      <div role="img" aria-label={summary}>
        {chart}
      </div>
      <div className="overflow-x-auto">{table}</div>
    </figure>
  );
}

const th = "px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground";
const td = "px-2 py-1.5 text-sm tabular-nums whitespace-nowrap";

function SmallTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full min-w-[17rem] border-collapse">
      <thead>
        <tr className="border-b border-border">
          {head.map((h, i) => (
            <th key={h} scope="col" className={cn(th, i > 0 && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">{children}</tbody>
    </table>
  );
}

export function Trends({ snapshot }: { snapshot: CfoSnapshot }) {
  const calm = useCalm();
  const months = snapshot.months;
  const partial = months.some((m) => m.partial);

  const money = months.map((m) => ({
    month: monthLabel(m),
    earned: m.earned.total,
    spent: m.hasData ? m.expenses.total : null,
    faded: !m.hasData ? 0.4 : m.partial ? 0.65 : 1,
  }));
  const people = months.map((m) => ({
    month: monthLabel(m),
    joined: m.newMembers,
    lost: -(m.notRenewed + m.leftEarly),
    faded: m.partial ? 0.65 : 1,
  }));
  const rate = months.map((m) => ({
    month: monthLabel(m),
    rate: m.renewalRate === null ? null : Math.round(m.renewalRate * 100),
  }));

  const moneyConfig = {
    earned: { label: "Earned", color: "var(--chart-2)" },
    spent: { label: "Spent", color: "var(--chart-3)" },
  } satisfies ChartConfig;
  const peopleConfig = {
    joined: { label: "New members", color: "var(--chart-5)" },
    lost: { label: "Lost members", color: "var(--chart-4)" },
  } satisfies ChartConfig;
  const rateConfig = {
    rate: { label: "Renewal rate", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const chartClass = "aspect-auto h-52 w-full sm:h-60";
  const axis = { tickLine: false, axisLine: false } as const;

  return (
    <section aria-labelledby="cfo-trends-title" className="space-y-3">
      <div>
        <h2 id="cfo-trends-title" className="text-section-title">
          Trends
        </h2>
        <p className="text-meta mt-0.5">
          The last 6 months{partial ? " and this month so far (marked *)" : ""}. Faded months are
          not complete. Every chart has its numbers in a table below it.
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title="Earned and spent"
          subLabel="Earned income vs expenses"
          summary={`Earned and spent each month. ${months
            .map(
              (m) =>
                `${monthShort(m.key)}: earned ${formatRupees(m.earned.total)}, ${m.hasData ? `spent ${formatRupees(m.expenses.total)}` : "no expense records yet"}`,
            )
            .join(". ")}.`}
          legend={[
            { label: "Earned", color: "var(--chart-2)" },
            { label: "Spent", color: "var(--chart-3)" },
          ]}
          chart={
            <ChartContainer config={moneyConfig} className={chartClass}>
              <BarChart data={money} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} strokeOpacity={0.5} />
                <XAxis dataKey="month" {...axis} tickMargin={8} />
                <YAxis {...axis} width={52} tickFormatter={axisMoney} />
                <ChartTooltip
                  cursor={{ fillOpacity: 0.08 }}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            {name === "earned" ? "Earned" : "Spent"}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatRupees(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="earned"
                  fill="var(--color-earned)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  isAnimationActive={!calm}
                >
                  {money.map((d) => (
                    <Cell key={d.month} fillOpacity={d.faded} />
                  ))}
                </Bar>
                <Bar
                  dataKey="spent"
                  fill="var(--color-spent)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  isAnimationActive={!calm}
                >
                  {money.map((d) => (
                    <Cell key={d.month} fillOpacity={d.faded} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          }
          table={
            <SmallTable head={["Month", "Earned", "Spent", "Profit"]}>
              {months.map((m) => (
                <tr key={m.key} className={cn(!m.hasData && "text-muted-foreground")}>
                  <th scope="row" className={cn(td, "text-left font-medium")}>
                    {monthShort(m.key)}
                    {m.partial ? " so far" : ""}
                  </th>
                  <td className={cn(td, "text-right")}>{formatRupees(m.earned.total)}</td>
                  <td className={cn(td, "text-right")}>
                    {m.hasData ? (
                      formatRupees(m.expenses.total)
                    ) : (
                      <>
                        <span aria-hidden>—</span>
                        <span className="sr-only">no expense records yet</span>
                      </>
                    )}
                  </td>
                  <td className={cn(td, "text-right")}>
                    {m.hasData ? formatRupees(m.profit) : <span aria-hidden>—</span>}
                  </td>
                </tr>
              ))}
              {months.some((m) => !m.hasData) ? (
                <tr>
                  <td colSpan={4} className="text-meta px-2 pt-2 whitespace-normal">
                    — = no expense records yet for that month, so no profit is shown.
                  </td>
                </tr>
              ) : null}
            </SmallTable>
          }
        />

        <ChartCard
          title="New and lost members"
          subLabel={`Net member growth. "Not renewed" is the Blacklist list in Member calls.`}
          summary={`New and lost members each month. ${months
            .map(
              (m) =>
                `${monthShort(m.key)}: ${formatCount(m.newMembers)} new, ${formatCount(m.notRenewed + m.leftEarly)} lost, net ${formatSignedCount(m.netGrowth)}`,
            )
            .join(". ")}.`}
          legend={[
            { label: "New members (up)", color: "var(--chart-5)" },
            { label: "Lost: not renewed or left early (down)", color: "var(--chart-4)" },
          ]}
          chart={
            <ChartContainer config={peopleConfig} className={chartClass}>
              <BarChart
                data={people}
                stackOffset="sign"
                margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeOpacity={0.5} />
                <XAxis dataKey="month" {...axis} tickMargin={8} />
                <YAxis {...axis} width={36} allowDecimals={false} />
                <ReferenceLine y={0} stroke="var(--color-border)" />
                <ChartTooltip
                  cursor={{ fillOpacity: 0.08 }}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            {name === "joined" ? "New members" : "Lost members"}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatCount(Math.abs(Number(value)))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="joined"
                  stackId="p"
                  fill="var(--color-joined)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  isAnimationActive={!calm}
                >
                  {people.map((d) => (
                    <Cell key={d.month} fillOpacity={d.faded} />
                  ))}
                </Bar>
                <Bar
                  dataKey="lost"
                  stackId="p"
                  fill="var(--color-lost)"
                  radius={[0, 0, 4, 4]}
                  maxBarSize={26}
                  isAnimationActive={!calm}
                >
                  {people.map((d) => (
                    <Cell key={d.month} fillOpacity={d.faded} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          }
          table={
            <SmallTable head={["Month", "New", "Not renewed", "Left early", "Net"]}>
              {months.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className={cn(td, "text-left font-medium")}>
                    {monthShort(m.key)}
                    {m.partial ? " so far" : ""}
                  </th>
                  <td className={cn(td, "text-right")}>{formatCount(m.newMembers)}</td>
                  <td className={cn(td, "text-right")}>{formatCount(m.notRenewed)}</td>
                  <td className={cn(td, "text-right")}>{formatCount(m.leftEarly)}</td>
                  <td className={cn(td, "text-right font-semibold")}>
                    {formatSignedCount(m.netGrowth)}
                  </td>
                </tr>
              ))}
            </SmallTable>
          }
        />

        <ChartCard
          title="Renewal rate"
          subLabel="Of the plans that ended, how many members came back"
          summary={`Renewal rate each month. ${months
            .map((m) => `${monthShort(m.key)}: ${formatPercent(m.renewalRate)}`)
            .join(". ")}.`}
          legend={[{ label: "Renewal rate", color: "var(--chart-2)" }]}
          chart={
            <ChartContainer config={rateConfig} className={chartClass}>
              <LineChart data={rate} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.5} />
                <XAxis dataKey="month" {...axis} tickMargin={8} />
                <YAxis
                  {...axis}
                  width={40}
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Renewal rate</span>
                          <span className="font-semibold tabular-nums">
                            {formatPercent(Number(value) / 100)}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Line
                  dataKey="rate"
                  type="monotone"
                  stroke="var(--color-rate)"
                  strokeWidth={2}
                  dot={{
                    r: 4,
                    strokeWidth: 2,
                    stroke: "var(--color-surface)",
                    fill: "var(--color-rate)",
                  }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={!calm}
                />
              </LineChart>
            </ChartContainer>
          }
          table={
            <SmallTable head={["Month", "Plans ending", "Renewed", "Not renewed", "Rate"]}>
              {months.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className={cn(td, "text-left font-medium")}>
                    {monthShort(m.key)}
                    {m.partial ? " so far" : ""}
                  </th>
                  <td className={cn(td, "text-right")}>{formatCount(m.plansEnded)}</td>
                  <td className={cn(td, "text-right")}>{formatCount(m.renewed)}</td>
                  <td className={cn(td, "text-right")}>
                    {formatCount(m.notRenewed)}
                    {m.stillDeciding ? (
                      <span className="text-meta block">
                        {formatCount(m.stillDeciding)} deciding
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(td, "text-right font-semibold")}>
                    {m.renewalRate === null ? (
                      <span className="font-normal text-muted-foreground">
                        <span aria-hidden>—</span>
                        <span className="sr-only">{NOT_ENOUGH_DATA}</span>
                      </span>
                    ) : (
                      formatPercent(m.renewalRate)
                    )}
                  </td>
                </tr>
              ))}
            </SmallTable>
          }
        />
      </div>
    </section>
  );
}
