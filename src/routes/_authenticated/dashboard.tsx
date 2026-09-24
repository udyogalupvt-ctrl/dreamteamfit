import { useState } from "react";
import { SegmentChart } from "@/components/members/segment-chart";
import { useAccess } from "@/hooks/use-access";
import { useMemberSegments } from "@/hooks/use-member-segments";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarClock,
  ChevronDown,
  CreditCard,
  Fingerprint,
  MessageCircle,
  Phone,
  RefreshCcw,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { useQuickActions } from "@/components/layout/quick-actions";
import { PageHeader } from "@/components/common/page-header";
import { StatCard, StatCardSkeleton } from "@/components/common/stat-card";
import { ErrorState } from "@/components/common/error-state";
import { SetupChecklist } from "@/components/common/setup-checklist";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAttention } from "@/hooks/use-attention";
import { useDashboardMetrics } from "@/hooks/use-dashboard-metrics";
import { useLive } from "@/hooks/use-live-query";
import { formatPrice } from "@/lib/format";
import { toneIcon } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { deviceConnection, subscribeDevices } from "@/services/biometric-devices.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  isWhatsAppApiLive,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { BiometricDevice } from "@/types/models";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — REBUILD FITNESS" },
      { name: "description", content: "What needs attention today, collections and members." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const { can, owner } = useAccess();
  const { openEnrollment } = useEnrollment();
  const actions = useQuickActions();
  const attention = useAttention();
  const { primary, stats, activity, todaySchedule, loading, error } = useDashboardMetrics();
  const [moreOpen, setMoreOpen] = useState(false);

  const tiles: {
    id: string;
    label: string;
    value: string;
    hint: string;
    icon: LucideIcon;
    urgent: boolean;
    go: () => void;
  }[] = [
    {
      id: "thumb",
      label: "Thumb pending",
      value: String(attention.thumbPending),
      hint: "paid, not yet on the device",
      icon: Fingerprint,
      urgent: attention.thumbPending > 0,
      go: () => void navigate({ to: "/clients", search: { filter: "pending" } }),
    },
    {
      id: "calls",
      label: "Calls due",
      value: String(attention.callsDue),
      hint: "follow-ups for today",
      icon: Phone,
      urgent: attention.callsDue > 0,
      go: () => void navigate({ to: "/leads", search: { tab: "followups" } }),
    },
    {
      id: "due",
      label: "Balance due",
      value: formatPrice(attention.balanceDueAmount),
      hint: `${attention.balanceDueCount} bill${attention.balanceDueCount === 1 ? "" : "s"}`,
      icon: CreditCard,
      urgent: attention.balanceDueCount > 0,
      go: () => void navigate({ to: "/billing" }),
    },
    {
      id: "ending",
      label: "Ending in 7 days",
      value: String(attention.expiringSoon),
      hint: "call them to renew",
      icon: RefreshCcw,
      urgent: attention.expiringSoon > 0,
      // Straight to the call list of these members, when this login has Member calls.
      go: () =>
        void (can("memberCalls")
          ? navigate({ to: "/member-calls", search: { segment: "expiring" } })
          : navigate({ to: "/clients", search: { filter: "active" } })),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="What needs you today, and how the gym is doing."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Dashboard" }]}
        actions={
          <Button size="lg" onClick={() => openEnrollment()}>
            <Users aria-hidden /> New member
          </Button>
        }
      />

      {error ? <ErrorState error={error} title="Couldn't load live metrics" /> : null}

      {owner ? <SetupChecklist /> : null}

      <section aria-labelledby="attention-title" className="space-y-3">
        <h2 id="attention-title" className="text-card-title">
          Needs attention
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={t.go}
                className={cn(
                  "surface-card flex flex-col items-start gap-1 p-4 text-left transition-colors hover:bg-accent",
                  t.urgent && "border-warning/60 bg-warning/5",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-meta font-semibold">{t.label}</span>
                  <Icon
                    className={cn("size-4", t.urgent ? "text-warning" : "text-muted-foreground")}
                    aria-hidden
                  />
                </span>
                <span className="font-display text-2xl font-extrabold tabular-nums">
                  {attention.loading ? "—" : t.value}
                </span>
                <span className="text-meta line-clamp-2">{t.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? primary.map((m) => <StatCardSkeleton key={m.id} />)
          : primary.map((metric) => <StatCard key={metric.id} metric={metric} />)}
      </section>

      {can("memberCalls") ? <MembersAtAGlance /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="surface-card p-4 sm:p-5">
          <h2 className="text-card-title">Quick actions</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <Button
                  key={a.id}
                  variant={a.id === "member" ? "default" : "outline"}
                  className="h-auto min-h-14 min-w-0 flex-col items-start justify-center gap-0.5 px-3 py-2 text-left whitespace-normal"
                  onClick={a.run}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon aria-hidden /> {a.label}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-normal",
                      a.id === "member" ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    {a.hint}
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
        <IntegrationsCard />
      </div>

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between sm:w-auto">
            {moreOpen ? "Hide" : "Show"} more numbers, schedule & activity
            <ChevronDown
              className={cn("transition-transform", moreOpen && "rotate-180")}
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((metric) => (
              <StatCard key={metric.id} metric={metric} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="surface-card min-w-0 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card-title">Today's schedule</h2>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/bookings">Bookings</Link>
                </Button>
              </div>
              {todaySchedule.length === 0 ? (
                <p className="text-meta py-6 text-center">No bookings today</p>
              ) : null}
              <ul className="mt-2 divide-y divide-border">
                {todaySchedule.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-3">
                    <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{item.time}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="surface-card min-w-0 p-5">
              <h2 className="text-card-title">Recent activity</h2>
              {activity.length === 0 ? (
                <p className="text-meta py-6 text-center">Your activity will appear here.</p>
              ) : null}
              <ul className="mt-2 divide-y divide-border">
                {activity.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id} className="flex items-start gap-3 py-3">
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The two integrations the gym depends on: WhatsApp bills and the fingerprint device. */
function IntegrationsCard() {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const linked = devices.data.filter(
    (d) => d.integrationType === "adms" && d.status !== "disabled",
  );
  const online = linked.filter((d) => deviceConnection(d).online);
  const waLive = isWhatsAppApiLive(wa.data);
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5">
      <h2 className="text-card-title">Connections</h2>
      <Link
        to="/settings"
        search={{ tab: "whatsapp" }}
        className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent"
      >
        <MessageCircle className="size-5 shrink-0 text-[#25D366]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">WhatsApp bills</span>
          <span className="text-meta">
            {waLive
              ? "Bills are sent automatically"
              : "Staff share with one tap · connect API for auto-send"}
          </span>
        </span>
        <StatusPill tone={waLive ? "success" : "info"}>{waLive ? "API live" : "Manual"}</StatusPill>
      </Link>
      <Link
        to="/biometric-devices"
        className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent"
      >
        <Fingerprint className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Fingerprint device</span>
          <span className="text-meta">
            {linked.length
              ? `${online.length} of ${linked.length} online`
              : "Not connected — thumbs can't be registered"}
          </span>
        </span>
        <StatusPill tone={online.length ? "success" : linked.length ? "danger" : "warning"}>
          {online.length ? "Online" : linked.length ? "Offline" : "Set up"}
        </StatusPill>
      </Link>
    </section>
  );
}

/** Member groups as a chart; tapping a bar opens that list in Member calls. */
function MembersAtAGlance() {
  const navigate = useNavigate();
  const { counts, total, loading } = useMemberSegments({
    absentDays: 7,
    expiringDays: 7,
    renewalWindowDays: 365,
  });
  return (
    <section className="surface-card space-y-3 p-4 sm:p-5" aria-labelledby="glance-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="glance-title" className="text-card-title">
          Members at a glance
        </h2>
        <Link to="/member-calls" className="text-sm font-semibold underline">
          Member calls
        </Link>
      </div>
      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : (
        <SegmentChart
          counts={counts}
          total={total}
          onSelect={(segment) => void navigate({ to: "/member-calls", search: { segment } })}
        />
      )}
    </section>
  );
}
