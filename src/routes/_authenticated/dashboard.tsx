import { createFileRoute } from "@tanstack/react-router";
import { CreditCard, FileText, MessageSquareHeart, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DASHBOARD_STATS, RECENT_ACTIVITY } from "@/constants/demo-data";
import { toneIcon } from "@/lib/tone";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FORGE Gym Management" },
      {
        name: "description",
        content: "Live snapshot of members, collections, attendance and follow-ups.",
      },
      { property: "og:title", content: "Dashboard — FORGE Gym Management" },
      {
        property: "og:description",
        content: "Live snapshot of members, collections, attendance and follow-ups.",
      },
    ],
  }),
  component: DashboardPage,
});

const QUICK_ACTIONS = [
  { label: "Create Inquiry", icon: UserPlus, variant: "default" as const },
  { label: "Create Client", icon: Users, variant: "outline" as const },
  { label: "Create Follow-up", icon: MessageSquareHeart, variant: "outline" as const },
  { label: "Create POS Bill", icon: CreditCard, variant: "outline" as const },
];

function DashboardPage() {
  const soon = (label: string) =>
    toast.info(`${label} arrives in the next build stage`, {
      description: "The foundation is ready — module logic ships next.",
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Today at a glance across memberships, revenue and floor activity."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Dashboard" }]}
        actions={
          <Tabs defaultValue="today">
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {/* Stats: swipeable on mobile, grid from sm up */}
      <section aria-label="Key metrics">
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {DASHBOARD_STATS.map((metric) => (
            <StatCard
              key={metric.id}
              metric={metric}
              className="w-[74vw] shrink-0 snap-start sm:w-auto"
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-6">
        {/* Quick actions */}
        <section className="surface-card min-w-0 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-section-title">Quick actions</h2>
            <Badge variant="secondary">Most used</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {QUICK_ACTIONS.map(({ label, icon: Icon, variant }) => (
              <Button
                key={label}
                variant={variant}
                size="lg"
                className="h-14 min-w-0 justify-start gap-3"
                onClick={() => soon(label)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Collection target", value: "78%", tone: "bg-success" },
              { label: "Renewal rate", value: "64%", tone: "bg-info" },
              { label: "Follow-up closure", value: "41%", tone: "bg-warning" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-meta">{item.label}</p>
                <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
                  {item.value}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className={cn("h-full rounded-full", item.tone)}
                    style={{ width: item.value }}
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
            <Button variant="ghost" size="sm" onClick={() => soon("Activity log")}>
              <FileText aria-hidden /> View all
            </Button>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {RECENT_ACTIVITY.map((item) => {
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
