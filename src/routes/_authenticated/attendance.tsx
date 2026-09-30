import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { addDays, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import {
  AlertTriangle,
  CalendarCheck,
  Clock,
  Fingerprint,
  LogIn,
  Plus,
  ShieldX,
  Users,
} from "lucide-react";
import { ManualAttendanceDialog } from "@/components/attendance/manual-attendance-dialog";
import { StaffAttendanceSection } from "@/components/attendance/staff-attendance-section";
import { SimulateScanDialog } from "@/components/attendance/simulate-scan-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatCard } from "@/components/common/stat-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLive } from "@/hooks/use-live-query";
import {
  ACCESS_REASON_LABELS,
  EVENT_LABELS,
  attendanceSummary,
  currentlyPresent,
} from "@/lib/attendance-utils";
import { formatNumber, todayISO } from "@/lib/format";
import { subscribeAttendanceDay, subscribeAttendanceRange } from "@/services/attendance.service";
import {
  deviceConnection,
  machineUserNames,
  subscribeDevices,
} from "@/services/biometric-devices.service";
import { subscribeClients } from "@/services/clients.service";
import type { AttendanceEvent, BiometricDevice, Client } from "@/types/models";
export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — REBUILD FITNESS" },
      {
        name: "description",
        content: "Live attendance, access decisions and biometric simulation.",
      },
      { property: "og:title", content: "Attendance — REBUILD FITNESS" },
      {
        property: "og:description",
        content: "Live attendance, access decisions and biometric simulation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AttendancePage,
});
type Period = "today" | "yesterday" | "week" | "month" | "custom";
/**
 * A punch from someone on the machine who isn't linked to a member yet: the machine let them
 * in; the app just doesn't know them. Shown as "not linked", not as a blocked attempt.
 */
const notLinked = (e: AttendanceEvent) => e.accessReason === "MEMBER_NOT_FOUND";
const accessTone = (e: AttendanceEvent) =>
  e.accessDecision === "allowed" ? "success" : notLinked(e) ? "info" : "danger";
const accessText = (e: AttendanceEvent) => (notLinked(e) ? "not linked" : e.accessDecision);
function AttendancePage() {
  const [manual, setManual] = useState(false),
    [simulate, setSimulate] = useState(false),
    [search, setSearch] = useState(""),
    [period, setPeriod] = useState<Period>("today"),
    [from, setFrom] = useState(todayISO()),
    [to, setTo] = useState(todayISO()),
    [device, setDevice] = useState("all"),
    [decision, setDecision] = useState("all"),
    [eventType, setEventType] = useState("all"),
    [source, setSource] = useState("all");
  const today = todayISO();
  const range = useMemo<[string, string]>(() => {
    const now = new Date();
    if (period === "yesterday") {
      const d = format(addDays(now, -1), "yyyy-MM-dd");
      return [d, d];
    }
    if (period === "week")
      return [
        format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      ];
    if (period === "month") return [format(startOfMonth(now), "yyyy-MM-dd"), today];
    if (period === "custom") return [from, to];
    return [today, today];
  }, [period, from, to, today]);
  // Only what is on screen: today's visits live, other dates only once they are picked, and the
  // member list only when a dialog needs it (the free plan allows 50,000 reads a day).
  const todayOnly = range[0] === today && range[1] === today;
  const todayLive = useLive<AttendanceEvent[]>(
    (ok, fail) => subscribeAttendanceDay(today, ok, fail),
    [],
    [today],
  );
  const rangeLive = useLive<AttendanceEvent[]>(
    todayOnly ? null : (ok, fail) => subscribeAttendanceRange(range[0], range[1], ok, fail),
    [],
    [todayOnly, range[0], range[1]],
  );
  const attendance = todayOnly ? todayLive : rangeLive;
  const clients = useLive<Client[]>(
      manual || simulate ? subscribeClients : null,
      [],
      [manual || simulate],
    ),
    devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  // Older punches from people not linked to a member yet were saved as "Unknown member": show
  // the name the machine has for them (looked up only for the ones on screen, a few reads).
  const [machineNames, setMachineNames] = useState<Record<string, string>>({});
  const named = useMemo(
    () => (list: AttendanceEvent[]) =>
      list.map((e) => {
        if (e.clientId) return e;
        const name = machineNames[`${e.deviceId}_${e.biometricUserId}`];
        return name ? { ...e, clientNameSnapshot: `${name} (not linked)` } : e;
      }),
    [machineNames],
  );
  const todayEvents = useMemo(() => named(todayLive.data), [named, todayLive.data]);
  const events = useMemo(
    () => (todayOnly ? todayEvents : named(rangeLive.data)),
    [todayOnly, todayEvents, named, rangeLive.data],
  );
  const summary = attendanceSummary(todayEvents),
    present = currentlyPresent(todayEvents);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return events.filter(
      (e) =>
        (device === "all" || e.deviceId === device) &&
        (decision === "all" || e.accessDecision === decision) &&
        (eventType === "all" || e.eventType === eventType) &&
        (source === "all" || e.source === source) &&
        (!q ||
          e.clientNameSnapshot.toLowerCase().includes(q) ||
          e.biometricUserId.toLowerCase().includes(q)),
    );
  }, [events, device, decision, eventType, source, search]);
  useEffect(() => {
    const keys = [
      ...new Set(
        [...todayLive.data, ...(todayOnly ? [] : rangeLive.data)]
          .filter(
            (e) =>
              !e.clientId &&
              e.deviceId &&
              e.biometricUserId &&
              e.clientNameSnapshot === "Unknown member",
          )
          .map((e) => `${e.deviceId}_${e.biometricUserId}`),
      ),
    ]
      .filter((k) => !(k in machineNames))
      .slice(0, 60);
    if (!keys.length) return;
    let live = true;
    void machineUserNames(keys).then((m) => {
      if (live) setMachineNames((cur) => ({ ...cur, ...m }));
    });
    return () => {
      live = false;
    };
  }, [todayLive.data, rangeLive.data, todayOnly, machineNames]);
  // Same test as the Fingerprint Devices page: a cloud machine is online while it keeps checking
  // in. Manual / test devices never make the page say "offline".
  const machines = devices.data.filter(
    (d) => d.integrationType === "adms" && d.status !== "disabled",
  );
  const offline = machines.length > 0 && machines.every((d) => !deviceConnection(d).online);
  const cards = [
    {
      id: "visits",
      label: "Total Visits",
      value: formatNumber(summary.visits),
      hint: "allowed check-ins today",
      icon: CalendarCheck,
      tone: "primary" as const,
    },
    {
      id: "unique",
      label: "Unique Members",
      value: formatNumber(summary.unique),
      hint: "today",
      icon: Users,
      tone: "info" as const,
    },
    {
      id: "present",
      label: "Currently Present",
      value: formatNumber(summary.present),
      hint: "latest event is check-in",
      icon: LogIn,
      tone: "success" as const,
    },
    {
      id: "blocked",
      label: "Blocked Attempts",
      value: formatNumber(summary.blocked),
      hint: "today",
      icon: ShieldX,
      tone: "danger" as const,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Live member visits, presence and biometric access decisions."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Attendance" }]}
        actions={
          <>
            <Button onClick={() => setManual(true)}>
              <Plus />
              Mark visit by hand
            </Button>
            {devices.data.some((d) => d.integrationType === "mock" && d.status !== "disabled") ? (
              <Button variant="outline" onClick={() => setSimulate(true)}>
                <Fingerprint />
                Test scan
              </Button>
            ) : null}
          </>
        }
      />
      {offline ? (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="font-semibold">Fingerprint machine is offline</p>
            <p className="text-meta">
              Mark visits by hand until it is back. Visits already recorded are safe.
            </p>
          </div>
          <Button variant="outline" onClick={() => setManual(true)}>
            Manual Attendance
          </Button>
        </div>
      ) : null}
      {attendance.error || clients.error || devices.error ? (
        <ErrorState
          error={
            attendance.error ??
            clients.error ??
            devices.error ??
            new Error("Unable to load attendance")
          }
          title="Couldn't load attendance"
        />
      ) : null}
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.id} metric={c} className="w-[74vw] shrink-0 sm:w-auto" />
        ))}
      </div>
      <Tabs defaultValue="today">
        {/* Six tabs don't fit a phone: the row scrolls sideways (like Settings). */}
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="present">Currently Present</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="access">Access Log</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="busy">Busy hours</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="busy">
          <BusyHours />
        </TabsContent>
        <TabsContent value="today">
          <EventList events={todayEvents} loading={attendance.loading} title="Today's Attendance" />
        </TabsContent>
        <TabsContent value="present">
          {present.length ? (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {present.map((e) => (
                <article className="surface-card p-4" key={e.clientId}>
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-lg bg-success/15 text-success">
                      <LogIn />
                    </span>
                    <div>
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: e.clientId }}
                        className="font-bold hover:underline"
                      >
                        {e.clientNameSnapshot}
                      </Link>
                      <p className="text-meta">
                        Checked in {format(e.timestamp, "hh:mm a")} · {e.deviceNameSnapshot}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <EmptyState
              icon={Users}
              title="Nobody is currently present"
              description="Allowed check-ins without a later check-out will appear here."
            />
          )}
        </TabsContent>
        <TabsContent value="history" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              label="Search attendance"
              placeholder="Member or biometric ID…"
            />
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="custom">Custom Date Range</SelectItem>
              </SelectContent>
            </Select>
            <Filter
              value={device}
              set={setDevice}
              label="All devices"
              values={devices.data.map((d) => [d.id, d.name])}
            />
            <Filter
              value={decision}
              set={setDecision}
              label="All decisions"
              values={[
                ["allowed", "Allowed"],
                ["blocked", "Blocked"],
              ]}
            />
            <Filter
              value={eventType}
              set={setEventType}
              label="All events"
              values={[
                ["check_in", "Check-in"],
                ["check_out", "Check-out"],
                ["unknown", "Unknown"],
              ]}
            />
            <Filter
              value={source}
              set={setSource}
              label="All sources"
              values={[
                ["biometric", "Biometric"],
                ["manual", "Manual"],
              ]}
            />
            {period === "custom" ? (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </>
            ) : null}
          </div>
          <EventList events={filtered} loading={attendance.loading} title="Attendance History" />
        </TabsContent>
        <TabsContent value="access">
          <EventList
            events={events}
            loading={attendance.loading}
            title="Biometric Access Log"
            access
          />
        </TabsContent>
        <TabsContent value="staff">
          <StaffAttendanceSection />
        </TabsContent>
      </Tabs>
      <ManualAttendanceDialog open={manual} onOpenChange={setManual} clients={clients.data} />
      <SimulateScanDialog
        open={simulate}
        onOpenChange={setSimulate}
        clients={clients.data}
        devices={devices.data}
      />
    </div>
  );
}
function Filter({
  value,
  set,
  label,
  values,
}: {
  value: string;
  set: (v: string) => void;
  label: string;
  values: Array<readonly [string, string]>;
}) {
  return (
    <Select value={value} onValueChange={set}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {values.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function EventList({
  events,
  loading,
  title,
  access = false,
}: {
  events: AttendanceEvent[];
  loading: boolean;
  title: string;
  access?: boolean;
}) {
  if (loading) return <LoadingRows rows={6} />;
  if (!events.length)
    return (
      <EmptyState
        icon={Clock}
        title={
          title === "Today's Attendance"
            ? "Nobody has come in yet today"
            : `No ${title.toLowerCase()}`
        }
        description="Each thumb punch at the door shows here. Use Mark visit by hand when the machine is off."
      />
    );
  return (
    <section className="surface-card overflow-hidden">
      <h2 className="text-section-title border-b border-border p-5">{title}</h2>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Biometric ID</TableHead>
              <TableHead>{access ? "Decision" : "Event"}</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>{access ? "Reason" : "Access"}</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{format(e.timestamp, "dd MMM, hh:mm a")}</TableCell>
                <TableCell className="font-semibold">{e.clientNameSnapshot}</TableCell>
                <TableCell className="font-mono">{e.biometricUserId || "—"}</TableCell>
                <TableCell>
                  <StatusPill tone={accessTone(e)}>
                    {access ? accessText(e) : EVENT_LABELS[e.eventType]}
                  </StatusPill>
                </TableCell>
                <TableCell>{e.deviceNameSnapshot}</TableCell>
                <TableCell>
                  {access ? (
                    ACCESS_REASON_LABELS[e.accessReason]
                  ) : (
                    <StatusPill tone={accessTone(e)}>{accessText(e)}</StatusPill>
                  )}
                </TableCell>
                <TableCell>{e.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y divide-border md:hidden">
        {events.map((e) => (
          <article className="p-4" key={e.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{e.clientNameSnapshot}</p>
                <p className="text-meta">
                  {format(e.timestamp, "dd MMM, hh:mm a")} · ID {e.biometricUserId || "—"}
                </p>
              </div>
              <StatusPill tone={accessTone(e)}>{accessText(e)}</StatusPill>
            </div>
            <p className="text-meta mt-3">
              {EVENT_LABELS[e.eventType]} · {e.deviceNameSnapshot} · {e.source}
            </p>
            <p className="mt-1 text-sm font-medium">{ACCESS_REASON_LABELS[e.accessReason]}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Members coming in per hour over the last 30 days (allowed check-ins), so the owner can plan
 * trainer shifts, cleaning and offers for quiet hours.
 */
function BusyHours() {
  // Loaded only while this tab is open: 14 days of visits (about 14 × daily visits in reads).
  const from = format(addDays(new Date(), -13), "yyyy-MM-dd");
  const recent = useLive<AttendanceEvent[]>(
    (ok, fail) => subscribeAttendanceRange(from, todayISO(), ok, fail),
    [],
    [from],
  );
  const events = recent.data;
  const since = Date.now() - 14 * 86_400_000;
  const counts = new Array<number>(24).fill(0);
  for (const e of events)
    if (
      e.accessDecision === "allowed" &&
      e.eventType !== "check_out" &&
      e.timestamp.getTime() >= since
    )
      counts[e.timestamp.getHours()]! += 1;
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total)
    return (
      <EmptyState
        icon={Clock}
        title="Not enough visits yet"
        description="Once members punch in for a few days, the busiest and quietest hours show here."
      />
    );
  const open = counts.map((n, h) => ({ h, n })).filter((x) => x.h >= 4 && x.h <= 23);
  const max = Math.max(...open.map((x) => x.n), 1);
  const peak = open.reduce((a, b) => (b.n > a.n ? b : a));
  const label = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  return (
    <section className="surface-card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-section-title">Busiest hours · last 14 days</h2>
        <p className="text-meta">
          {total} visits. Busiest at {label(peak.h)} ({peak.n} visits). Plan trainers and cleaning
          around it.
        </p>
      </div>
      <ol className="space-y-1.5">
        {open.map((x) => (
          <li key={x.h} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2 text-sm">
            <span className="text-meta tabular-nums">{label(x.h)}</span>
            <span className="h-3 overflow-hidden rounded-full bg-muted">
              <span
                className={
                  x.h === peak.h ? "block h-full bg-primary" : "block h-full bg-primary/50"
                }
                style={{ width: `${(x.n / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{x.n}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
