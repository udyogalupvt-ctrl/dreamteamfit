import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarClock, CalendarPlus, Dumbbell, ReceiptIndianRupee, Salad, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard, StatCardSkeleton } from "@/components/common/stat-card";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardMetrics } from "@/hooks/use-dashboard-metrics";
import { toneIcon } from "@/lib/tone";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — REBUILD FITNESS" },
      {
        name: "description",
        content: "Live snapshot of members, collections, attendance and follow-ups.",
      },
      { property: "og:title", content: "Dashboard — REBUILD FITNESS" },
      {
        property: "og:description",
        content: "Live snapshot of members, collections, attendance and follow-ups.",
      },
    ],
  }),
  component: DashboardPage,
});

const QUICK_ACTIONS = [
  { label: "Create Inquiry", icon: UserPlus, variant: "default" as const, to: "/inquiries" as const },
  { label: "Create Client", icon: Users, variant: "outline" as const, to: "/clients" as const },
  { label: "Create Booking", icon: CalendarPlus, variant: "default" as const, to: "/bookings" as const, search: { create: true } },
  { label: "Add Expense", icon: ReceiptIndianRupee, variant: "outline" as const, to: "/expenses" as const, search: { create: true } },
  { label: "Add Workout Plan", icon: Dumbbell, variant: "outline" as const, to: "/workout-plans" as const, search: { create: true } },
  { label: "Add Diet Plan", icon: Salad, variant: "outline" as const, to: "/diet-plans" as const, search: { create: true } },
];

function DashboardPage() {
  const navigate = useNavigate();
  const { stats, ratios, activity, todaySchedule, loading, error } = useDashboardMetrics();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Today at a glance across memberships, revenue and floor activity."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Dashboard" }]}
      />

      {error ? <ErrorState error={error} title="Couldn't load live metrics" /> : null}

      {/* Stats: swipeable on mobile, grid from sm up */}
      <section aria-label="Key metrics">
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {loading
            ? stats.map((m) => (
                <StatCardSkeleton key={m.id} className="w-[74vw] shrink-0 snap-start sm:w-auto" />
              ))
            : stats.map((metric) => (
                <StatCard
                  key={metric.id}
                  metric={metric}
                  className="w-[74vw] shrink-0 snap-start sm:w-auto"
                />
              ))}
        </div>
      </section>

      <section className="surface-card min-w-0 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section-title">Today's Schedule</h2>
          <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/bookings" })}>View bookings</Button>
        </div>
        {!loading && todaySchedule.length === 0 ? <p className="text-meta py-8 text-center">No bookings today</p> : null}
        <ul className="mt-3 divide-y divide-border">
          {todaySchedule.map((item) => <li key={item.id} className="flex items-center gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary-foreground"><CalendarClock className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div><span className="text-sm font-semibold tabular-nums">{item.time}</span></li>)}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-6">
        {/* Quick actions */}
        <section className="surface-card min-w-0 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-section-title">Quick actions</h2>
            <Badge variant="secondary">Most used</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {QUICK_ACTIONS.map(({ label, icon: Icon, variant, ...rest }) => (
              <Button
                key={label}
                variant={variant}
                size="lg"
                className="h-14 min-w-0 justify-start gap-3"
                onClick={() => {
                  if ("search" in rest) void navigate({ to: rest.to, search: rest.search });
                  else void navigate({ to: rest.to });
                }}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {ratios.map((r) => ({ ...r, value: r.pct === null ? "—" : `${r.pct}%` })).map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-meta">{item.label}</p>
                <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
                  {item.value}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className={cn("h-full rounded-full", item.tone)}
                    style={{ width: `${item.pct ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Recent activity */}
        <section className="surface-card flex min-w-0 flex-col p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-section-title">Recent activity</h2>
          </div>
          {!loading && activity.length === 0 ? (
            <p className="text-meta py-8 text-center">
               Your activity will appear here.
            </p>
          ) : null}
          <ul className="mt-3 divide-y divide-border">
            {activity.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id} className="flex items-start gap-3 py-3">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                      toneIcon[item.tone],
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="text-meta shrink-0 whitespace-nowrap">{item.time}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
