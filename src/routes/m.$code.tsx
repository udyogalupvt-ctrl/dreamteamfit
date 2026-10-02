import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCheck,
  ChevronRight,
  Dumbbell,
  Home,
  Hourglass,
  MapPin,
  MessageCircle,
  Phone,
  ReceiptIndianRupee,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { StatusPill } from "@/components/common/status-pill";
import { AppSetupCard, NotificationToggle } from "@/components/portal/app-setup";
import { ChatPanel, isUnread, mapThread } from "@/components/portal/chat-panel";
import {
  CheckRow,
  PlanHeading,
  WeekStrip,
  dayItems,
  mealItems,
  nextWorkoutDay,
} from "@/components/portal/plan-view";
import {
  BottomNav,
  PortalError,
  PortalGate,
  PortalHeader,
  PortalLoading,
  day,
  daysBetween,
  rupees,
  usePortalData,
  type NavItem,
} from "@/components/portal/portal-shell";
import { VisitsCalendar, clock12, sessionOf } from "@/components/portal/visits-calendar";
import { FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import {
  indiaToday,
  shiftDate,
  type MemberPortalData,
  type PortalLog,
  type PortalMembership,
} from "@/constants/portal";
import { portalDb } from "@/lib/portal-firebase";
import { cn } from "@/lib/utils";
import type { StatTone } from "@/types";
import type { ChatThread } from "@/types/models";

const TABS = ["home", "workout", "visits", "payments", "chat"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/m/$code")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search["tab"] as Tab) ? { tab: search["tab"] as Tab } : {},
  head: () => ({
    meta: [
      { title: "My gym" },
      { name: "description", content: "Your membership, visits, payments and workout plan." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MemberAppPage,
});

function MemberAppPage() {
  const { code } = Route.useParams();
  return (
    <PortalGate kind="member" code={code}>
      <MemberApp />
    </PortalGate>
  );
}

function MemberApp() {
  const { tab = "home" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const go = (t: Tab) => void navigate({ search: t === "home" ? {} : { tab: t } });
  const { data, error, loading, reload } = usePortalData<MemberPortalData>();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const memberId = data?.member.id;
  const hasTrainer = !!data?.trainer;
  useEffect(() => {
    if (!memberId || !hasTrainer) return;
    return onSnapshot(
      doc(portalDb, "chats", memberId),
      (s) => setThread(mapThread(s)),
      () => undefined,
    );
  }, [memberId, hasTrainer]);
  // Today's ticks, live: Home shows the same count as the Workout tab right after ticking.
  const today = indiaToday();
  const [todayLog, setTodayLog] = useState<PortalLog | null | undefined>(undefined);
  useEffect(() => {
    if (!memberId) return;
    return onSnapshot(
      doc(portalDb, "planLogs", `${memberId}_${today}`),
      (s) => setTodayLog(readLog(s.data(), today)),
      () => undefined,
    );
  }, [memberId, today]);

  if (!data)
    return (
      <div className="min-h-dvh bg-background">
        {loading ? (
          <PortalLoading />
        ) : (
          <PortalError message={error} onRetry={() => void reload()} />
        )}
      </div>
    );

  const items: NavItem<Tab>[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "workout", label: "Workout", icon: Dumbbell },
    { id: "visits", label: "Visits", icon: CalendarCheck },
    { id: "payments", label: "Payments", icon: ReceiptIndianRupee },
    ...(data.trainer
      ? [
          {
            id: "chat" as const,
            label: "Trainer",
            icon: MessageCircle,
            dot: tab !== "chat" && isUnread(thread, "member"),
          },
        ]
      : []),
  ];
  const current = tab === "chat" && !data.trainer ? "home" : tab;
  const first = data.member.name.split(" ")[0] || data.member.name;
  const live: MemberPortalData =
    todayLog === undefined
      ? data
      : {
          ...data,
          logs: [...data.logs.filter((l) => l.date !== today), ...(todayLog ? [todayLog] : [])],
        };

  return (
    <div className="min-h-dvh bg-background pb-24">
      <PortalHeader
        gymName={data.gym.name}
        logoUrl={data.gym.logoUrl}
        title={
          current === "home"
            ? `Hi, ${first}`
            : current === "workout"
              ? "Workout & diet"
              : current === "visits"
                ? "My visits"
                : current === "payments"
                  ? "Packages & payments"
                  : `Chat with ${data.trainer?.name ?? "trainer"}`
        }
        onRefresh={() => void reload()}
        refreshing={loading}
      />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {current === "home" ? <HomeTab data={live} go={go} /> : null}
        {current === "workout" ? <WorkoutTab data={live} /> : null}
        {current === "visits" ? <VisitsTab data={data} /> : null}
        {current === "payments" ? <PaymentsTab data={data} /> : null}
        {current === "chat" && data.trainer ? (
          <ChatPanel
            clientId={data.member.id}
            me="member"
            myName={data.member.name}
            otherName={data.trainer.name}
            className="h-[calc(100dvh-10.5rem-env(safe-area-inset-bottom))]"
          />
        ) : null}
      </main>
      <BottomNav items={items} value={current} onChange={go} />
      <RenewalPopup data={data} />
    </div>
  );
}

/** wa.me link to the gym's number with the message typed in (free: opens the member's WhatsApp). */
function whatsappLink(phone: string, message: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : "";
}
const renewText = (d: MemberPortalData) =>
  `Hi, I would like to renew my package. ${d.member.name}${d.member.memberId ? `, Member ID ${d.member.memberId}` : ""}.`;

/**
 * From 7 days before the package ends (and after it ended, until renewed): a popup when the app
 * opens, once a day, with Renew on WhatsApp / Call the gym. Not shown when a renewal is queued.
 */
function RenewalPopup({ data }: { data: MemberPortalData }) {
  const { current, today, member, gym } = data;
  const renewed = data.memberships.some(
    (m) => m.status === "pending" || m.status === "biometric_pending",
  );
  const ended = current
    ? undefined
    : data.memberships
        .filter((m) => m.status === "expired" || m.status === "completed")
        .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const left = current ? Math.max(0, daysBetween(today, current.endDate)) : 0;
  const due = !renewed && ((current && left <= 7) || (!current && !!ended));
  const key = `rf-renew-popup-${member.id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!due) return;
    let seen = "";
    try {
      seen = localStorage.getItem(key) ?? "";
    } catch {
      /* storage blocked: shown every time */
    }
    if (seen !== today) setOpen(true);
  }, [due, key, today]);
  if (!due) return null;
  const close = () => {
    try {
      localStorage.setItem(key, today);
    } catch {
      /* storage blocked */
    }
    setOpen(false);
  };
  const plan = (current ?? ended)!;
  const wa = whatsappLink(gym.phone, renewText(data));
  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : close())}
      title={
        current
          ? left === 0
            ? "Your package ends today"
            : `Your package ends in ${left} day${left === 1 ? "" : "s"}`
          : "Your package has ended"
      }
      description={
        current
          ? `${plan.packageName} ends on ${day(plan.endDate)}. Renew now to keep training without a break.`
          : `${plan.packageName} ended on ${day(plan.endDate)}. Renew to start training again.`
      }
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          {wa ? (
            <Button asChild className="bg-[#128C7E] text-white hover:bg-[#0e7266]">
              <a href={wa} target="_blank" rel="noreferrer" onClick={close}>
                <MessageCircle aria-hidden /> Renew on WhatsApp
              </a>
            </Button>
          ) : null}
          {gym.phone ? (
            <Button asChild variant="outline">
              <a href={`tel:${gym.phone.replace(/\s/g, "")}`} onClick={close}>
                <Phone aria-hidden /> Call the gym
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" onClick={close}>
            Later
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-xl bg-warning/15 p-3">
        <Hourglass className="size-6 shrink-0 text-warning" aria-hidden />
        <p className="text-sm">
          Renew at the front desk, or message the gym on WhatsApp and they will get it ready for
          you.
        </p>
      </div>
    </FormDialog>
  );
}

/** A planLogs document as the app uses it; null when there is none yet. */
function readLog(d: Record<string, unknown> | undefined, date: string): PortalLog | null {
  if (!d) return null;
  const nums = (x: unknown) => (Array.isArray(x) ? x.map(Number) : []);
  return {
    date,
    workoutDay: Number(d["workoutDay"] ?? 0),
    workoutDone: nums(d["workoutDone"]),
    dietDone: nums(d["dietDone"]),
  };
}

// ------------------------------------------------------------------ home

const PLAN_STATUS: Record<string, { label: string; tone: StatTone }> = {
  active: { label: "Running", tone: "success" },
  pending: { label: "Starts later", tone: "info" },
  expired: { label: "Ended", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
  biometric_pending: { label: "Starts at first thumb", tone: "info" },
  completed: { label: "Ended", tone: "warning" },
};
const statusOf = (s: string) => PLAN_STATUS[s] ?? { label: s, tone: "info" as StatTone };

function HomeTab({ data, go }: { data: MemberPortalData; go: (t: Tab) => void }) {
  const { member, current, today } = data;
  const upcoming = data.memberships
    .filter((m) => m.status === "pending")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const ended = data.memberships
    .filter((m) => m.status === "expired")
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const month = data.visits.filter((v) => v.startsWith(today.slice(0, 7))).length;
  const w = data.workout;
  const todayLog = data.logs.find((l) => l.date === today);
  const wDay = w ? nextWorkoutDay(w, data.logs, today) : 0;
  const wItems = w ? dayItems(w, wDay) : [];
  const wDone = todayLog && todayLog.workoutDay === wDay ? todayLog.workoutDone.length : 0;

  const lastDay = data.visits[0];
  const lastTime = lastDay ? data.visitTimes[lastDay] : "";
  const LastIcon = lastTime ? sessionOf(lastTime).Icon : CalendarCheck;
  const renewUrl = whatsappLink(data.gym.phone, renewText(data));
  return (
    <>
      <AppSetupCard kind="member" />
      <section className="surface-card flex items-center gap-4 p-4">
        <ClientAvatar name={member.name} url={member.photoUrl || null} size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-card-title truncate">{member.name}</p>
          <p className="text-meta">Member ID {member.memberId || "—"}</p>
          {lastDay ? (
            <p className="text-meta mt-0.5 flex items-center gap-1">
              <LastIcon className="size-3.5 shrink-0" aria-hidden />
              Last visit:{" "}
              {lastDay === today
                ? "Today"
                : lastDay === shiftDate(today, -1)
                  ? "Yesterday"
                  : day(lastDay)}
              {lastTime ? `, ${clock12(lastTime)}` : ""}
            </p>
          ) : null}
          <div className="mt-1.5">
            {current ? (
              <StatusPill tone="success">Active member</StatusPill>
            ) : upcoming ? (
              <StatusPill tone="info">Starts {day(upcoming.startDate)}</StatusPill>
            ) : (
              <StatusPill tone="warning">No running package</StatusPill>
            )}
          </div>
        </div>
      </section>

      {current ? (
        <CurrentPlan m={current} today={today} renewUrl={renewUrl} />
      ) : (
        <section className="surface-card border-warning/50 bg-warning/10 p-4">
          <p className="font-bold">
            {upcoming
              ? `${upcoming.packageName} starts on ${day(upcoming.startDate)}`
              : ended
                ? `Your package ended on ${day(ended.endDate)}`
                : "You have no package yet"}
          </p>
          {!upcoming ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Visit the front desk to renew and keep training.
            </p>
          ) : null}
          {!upcoming && renewUrl ? (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <a href={renewUrl} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden /> Renew on WhatsApp
              </a>
            </Button>
          ) : null}
        </section>
      )}

      {data.balanceDue > 0 ? (
        <button
          type="button"
          onClick={() => go("payments")}
          className="surface-card flex w-full cursor-pointer items-center gap-3 border-warning/60 p-4 text-left"
        >
          <AlertTriangle className="size-6 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{rupees(data.balanceDue)} to pay</span>
            <span className="text-meta">
              {data.nextDueDate ? `Due on ${day(data.nextDueDate)}` : "Balance on your bill"}
            </span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </button>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Visits this month" value={String(month)} onClick={() => go("visits")} />
        <Stat
          label="Total visits"
          value={String(data.visits.length)}
          onClick={() => go("visits")}
        />
        <Stat
          label="Workout today"
          value={w ? `${Math.min(wDone, wItems.length)}/${wItems.length}` : "—"}
          onClick={() => go("workout")}
        />
      </div>

      {w || data.diet ? (
        <button
          type="button"
          onClick={() => go("workout")}
          className="surface-card flex w-full cursor-pointer items-center gap-3 p-4 text-left"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Dumbbell className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Today's plan</span>
            <span className="text-meta block truncate">
              {w ? w.days[wDay]?.title || w.name : data.diet?.name}
            </span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </button>
      ) : null}

      {data.trainer ? (
        <button
          type="button"
          onClick={() => go("chat")}
          className="surface-card flex w-full cursor-pointer items-center gap-3 p-4 text-left"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info text-info-foreground">
            <MessageCircle className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Your trainer: {data.trainer.name}</span>
            <span className="text-meta">
              {data.pt[0]
                ? `PT till ${day(data.pt.find((p) => p.status === "active")?.endDate)}`
                : ""}
              {" · Send a message"}
            </span>
          </span>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </button>
      ) : null}

      <section className="surface-card p-4">
        <h2 className="text-card-title flex items-center gap-2">
          <UserRound className="size-4" aria-hidden /> My details
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail label="Name" value={member.name} />
          <Detail label="Member ID" value={member.memberId} />
          <Detail label="Phone" value={member.phone} />
          <Detail label="Date of birth" value={day(member.dateOfBirth)} />
          <Detail
            label="Gender"
            value={
              member.gender && member.gender !== "unspecified"
                ? member.gender[0]!.toUpperCase() + member.gender.slice(1)
                : "—"
            }
          />
          <Detail label="Joined on" value={day(member.joinedOn)} />
          <Detail label="Email" value={member.email} wide />
          <Detail label="Address" value={member.address} wide />
          <Detail label="Emergency contact" value={member.emergencyContact} wide />
        </dl>
        <p className="text-meta mt-3">To change your details, please tell the front desk.</p>
      </section>

      <section className="surface-card space-y-2 p-4 text-sm">
        <h2 className="text-card-title">{data.gym.name}</h2>
        {data.gym.address ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {data.gym.address}
          </p>
        ) : null}
        {data.gym.phone ? (
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${data.gym.phone.replace(/\s/g, "")}`}>
              <Phone aria-hidden /> Call {data.gym.phone}
            </a>
          </Button>
        ) : null}
        <NotificationToggle kind="member" className="border-t border-border pt-3" />
      </section>
    </>
  );
}

function CurrentPlan({
  m,
  today,
  renewUrl,
}: {
  m: PortalMembership;
  today: string;
  renewUrl: string;
}) {
  const total = Math.max(1, daysBetween(m.startDate, m.endDate));
  const left = Math.max(0, daysBetween(today, m.endDate));
  const pct = Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100)));
  return (
    <section className="surface-card relative overflow-hidden p-4">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-eyebrow">My package</p>
          <h2 className="text-card-title mt-0.5">{m.packageName}</h2>
          <p className="text-meta">
            {day(m.startDate)} → {day(m.endDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-stat">{left}</p>
          <p className="text-meta">days left</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full", left <= 7 ? "bg-warning" : "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {left <= 7 ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-warning-foreground dark:text-warning">
            Ending soon. Renew at the front desk to keep going.
          </p>
          {renewUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={renewUrl} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden /> Renew on WhatsApp
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
      {m.pausedDays ? <p className="text-meta mt-2">Includes {m.pausedDays} paused days.</p> : null}
    </section>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="surface-card cursor-pointer p-3 text-left hover:bg-accent/40"
    >
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
      <p className="text-meta leading-tight">{label}</p>
    </button>
  );
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-meta">{label}</dt>
      <dd className="mt-0.5 font-semibold break-words">{value || "—"}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ workout & diet

function WorkoutTab({ data }: { data: MemberPortalData }) {
  const today = indiaToday();
  const clientId = data.member.id;
  const w = data.workout;
  const diet = data.diet;
  const [log, setLog] = useState<PortalLog | null>(data.logs.find((l) => l.date === today) ?? null);
  const [dayIdx, setDayIdx] = useState(() => (w ? nextWorkoutDay(w, data.logs, today) : 0));
  const [saving, setSaving] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(portalDb, "planLogs", `${clientId}_${today}`),
        (s) => {
          const next = readLog(s.data(), today);
          if (next) setLog(next);
        },
        () => undefined,
      ),
    [clientId, today],
  );

  const logs = [...data.logs.filter((l) => l.date !== today), ...(log ? [log] : [])];
  if (!w && !diet)
    return (
      <section className="surface-card p-6 text-center">
        <Dumbbell className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 font-bold">No plan yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.trainer
            ? `Your trainer ${data.trainer.name} will add your workout and diet here.`
            : "Ask the front desk or a trainer to give you a workout and diet plan."}
        </p>
      </section>
    );

  const save = async (patch: Partial<PortalLog>) => {
    const before = log;
    const next: PortalLog = {
      date: today,
      workoutDay: log?.workoutDay ?? dayIdx,
      workoutDone: log?.workoutDone ?? [],
      dietDone: log?.dietDone ?? [],
      ...patch,
    };
    setLog(next);
    setSaving(true);
    try {
      await setDoc(doc(portalDb, "planLogs", `${clientId}_${today}`), {
        clientId,
        ...next,
        updatedAt: serverTimestamp(),
      });
    } catch {
      setLog(before);
      toast.error("Not saved. Check your internet and try again.");
    } finally {
      setSaving(false);
    }
  };

  const items = w ? dayItems(w, dayIdx) : [];
  const sameDay = (log?.workoutDay ?? dayIdx) === dayIdx;
  const done = sameDay ? (log?.workoutDone ?? []) : [];
  const toggle = (i: number) =>
    void save({
      workoutDay: dayIdx,
      workoutDone: done.includes(i) ? done.filter((x) => x !== i) : [...done, i],
    });
  const meals = diet ? mealItems(diet) : [];
  const ate = log?.dietDone ?? [];

  return (
    <>
      {w ? (
        <section className="surface-card overflow-hidden">
          <PlanHeading
            kind="workout"
            name={w.name}
            sub={`${w.goal ? `${w.goal} · ` : ""}by ${w.by}`}
          />
          {w.days.length > 1 ? (
            <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3" role="tablist">
              {w.days.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === dayIdx}
                  onClick={() => setDayIdx(i)}
                  className={cn(
                    "shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold",
                    i === dayIdx
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {d.title || `Day ${i + 1}`}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
            <p className="text-sm font-bold">
              {w.days[dayIdx]?.title || "Today"} · {Math.min(done.length, items.length)}/
              {items.length} done
            </p>
            {done.length < items.length ? (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() =>
                  void save({ workoutDay: dayIdx, workoutDone: items.map((_, i) => i) })
                }
              >
                <CheckCheck aria-hidden /> All done
              </Button>
            ) : (
              <StatusPill tone="success">Great work!</StatusPill>
            )}
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {items.map((x, i) => (
              <CheckRow key={i} label={x} done={done.includes(i)} onToggle={() => toggle(i)} />
            ))}
          </ul>
          {w.description || w.notes ? (
            <div className="space-y-1 border-t border-border p-4 text-sm text-muted-foreground">
              {w.description ? <p className="whitespace-pre-wrap">{w.description}</p> : null}
              {w.notes ? <p className="whitespace-pre-wrap">Note: {w.notes}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {diet ? (
        <section className="surface-card overflow-hidden">
          <PlanHeading
            kind="diet"
            name={diet.name}
            sub={`${diet.calories ? `${diet.calories} kcal a day · ` : ""}by ${diet.by}`}
          />
          <p className="border-t border-border px-4 py-2 text-sm font-bold">
            Today · {Math.min(ate.length, meals.length)}/{meals.length} meals
          </p>
          <ul className="divide-y divide-border border-t border-border">
            {meals.map((x, i) => (
              <CheckRow
                key={i}
                label={x}
                done={ate.includes(i)}
                onToggle={() =>
                  void save({
                    dietDone: ate.includes(i) ? ate.filter((y) => y !== i) : [...ate, i],
                  })
                }
              />
            ))}
          </ul>
          {diet.description || diet.notes ? (
            <div className="space-y-1 border-t border-border p-4 text-sm text-muted-foreground">
              {diet.description ? <p className="whitespace-pre-wrap">{diet.description}</p> : null}
              {diet.notes ? <p className="whitespace-pre-wrap">Note: {diet.notes}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="surface-card space-y-3 p-4">
        <h2 className="text-card-title">Last 7 days</h2>
        <WeekStrip logs={logs} today={today} workout={w} diet={diet} />
      </section>
    </>
  );
}

// ------------------------------------------------------------------ visits

function VisitsTab({ data }: { data: MemberPortalData }) {
  const { visits, today } = data;
  const last30 = visits.filter((v) => v > shiftDate(today, -30)).length;
  const month = visits.filter((v) => v.startsWith(today.slice(0, 7))).length;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["This month", month],
          ["Last 30 days", last30],
          ["All time", visits.length],
        ].map(([label, value]) => (
          <div key={label} className="surface-card p-3">
            <p className="text-xl font-extrabold tabular-nums">{value}</p>
            <p className="text-meta leading-tight">{label}</p>
          </div>
        ))}
      </div>
      <UsualTime
        times={visits
          .slice(0, 30)
          .map((v) => data.visitTimes[v] ?? "")
          .filter(Boolean)}
      />
      <VisitsCalendar visits={visits} today={today} times={data.visitTimes} />
      <p className="text-meta text-center">
        {visits[0] ? `Last visit: ${day(visits[0])}` : "No visits recorded yet."} Visits are counted
        from the fingerprint machine.
      </p>
    </>
  );
}

const hhmmOf = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "You usually come in the morning, around 6:15 AM" from the last 30 arrival times. */
function UsualTime({ times }: { times: string[] }) {
  if (times.length < 3) return null;
  const counts = new Map<string, number>();
  for (const t of times) counts.set(sessionOf(t).label, (counts.get(sessionOf(t).label) ?? 0) + 1);
  const [label, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  // The middle arrival time of that part of the day.
  const mins = times
    .filter((t) => sessionOf(t).label === label)
    .map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)))
    .sort((a, b) => a - b);
  const usual = hhmmOf(mins[Math.floor(mins.length / 2)]!);
  const { Icon } = sessionOf(usual);
  return (
    <section className="surface-card flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="min-w-0 text-sm">
        You usually come in the <b>{label.toLowerCase()}</b>, around <b>{clock12(usual)}</b>.
        <span className="text-meta block">
          {count} of your last {times.length} visits.
        </span>
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ packages & payments

function PaymentsTab({ data }: { data: MemberPortalData }) {
  return (
    <>
      {data.balanceDue > 0 ? (
        <section className="surface-card border-warning/60 bg-warning/10 p-4">
          <p className="font-bold">{rupees(data.balanceDue)} left to pay</p>
          <p className="text-meta">
            {data.nextDueDate ? `Please pay by ${day(data.nextDueDate)} at the front desk.` : ""}
          </p>
        </section>
      ) : null}

      <section className="surface-card overflow-hidden">
        <h2 className="text-card-title border-b border-border p-4">Packages taken</h2>
        {!data.memberships.length ? (
          <p className="p-4 text-sm text-muted-foreground">No packages yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.memberships.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{m.packageName}</p>
                  <p className="text-meta">
                    {day(m.startDate)} → {day(m.endDate)} · {m.days} days
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{rupees(m.price)}</span>
                  <StatusPill tone={statusOf(m.status).tone}>{statusOf(m.status).label}</StatusPill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.oldHistory?.plans.length ? (
        <section className="surface-card overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="text-card-title">Earlier packages</h2>
            <p className="text-meta">
              From the gym's old software · member since {day(data.oldHistory.joinedOn)}
            </p>
            {data.oldHistory.plans.some((p) => p.balance > 0) ? (
              <p className="text-meta mt-1">
                Balances here are as they were in the old software. What you owe now is under Bills
                below.
              </p>
            ) : null}
          </div>
          <ul className="divide-y divide-border">
            {data.oldHistory.plans.map((p, i) => (
              <li key={i} className="space-y-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-meta">
                      {day(p.start)} → {day(p.end)}
                      {p.bill ? ` · bill no. ${p.bill}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{rupees(p.amount)}</span>
                </div>
                <p className="text-meta tabular-nums">
                  {p.discount ? `${rupees(p.price)} less ${rupees(p.discount)} · ` : ""}
                  Paid {rupees(p.paid)}
                  {p.balance > 0 ? ` · balance ${rupees(p.balance)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.pt.length ? (
        <section className="surface-card overflow-hidden">
          <h2 className="text-card-title border-b border-border p-4">Personal training</h2>
          <ul className="divide-y divide-border">
            {data.pt.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{p.packageName}</p>
                  <p className="text-meta">
                    With {p.trainerName} · {day(p.startDate)} → {day(p.endDate)}
                  </p>
                </div>
                <StatusPill tone={statusOf(p.status).tone}>{statusOf(p.status).label}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="surface-card overflow-hidden">
        <h2 className="text-card-title border-b border-border p-4">Bills</h2>
        {!data.bills.length ? (
          <p className="p-4 text-sm text-muted-foreground">No bills yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.bills.map((b) => (
              <li key={b.number || b.token} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{b.number}</p>
                    <p className="text-meta">
                      {day(b.date)}
                      {b.items.length ? ` · ${b.items.join(", ")}` : ""}
                    </p>
                  </div>
                  <StatusPill
                    tone={b.balance > 0 ? "warning" : b.status === "closed" ? "info" : "success"}
                  >
                    {b.balance > 0 ? "Part paid" : b.status === "closed" ? "Closed" : "Paid"}
                  </StatusPill>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <span>
                    <span className="text-meta block">Total</span>
                    <b className="tabular-nums">{rupees(b.total)}</b>
                  </span>
                  <span>
                    <span className="text-meta block">Paid</span>
                    <b className="tabular-nums">{rupees(b.paid)}</b>
                  </span>
                  <span>
                    <span className="text-meta block">Balance</span>
                    <b className="tabular-nums">{rupees(b.balance)}</b>
                  </span>
                </div>
                {b.balance > 0 && b.dueDate ? (
                  <p className="text-sm font-semibold text-warning-foreground dark:text-warning">
                    Next payment by {day(b.dueDate)}
                  </p>
                ) : null}
                {b.token ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/invoice/${b.token}`} target="_blank" rel="noreferrer">
                      <ReceiptIndianRupee aria-hidden /> View / download bill
                    </a>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.payments.length ? (
        <section className="surface-card overflow-hidden">
          <h2 className="text-card-title border-b border-border p-4">Payments made</h2>
          <ul className="divide-y divide-border">
            {data.payments.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 p-4 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold">{day(p.date)}</span>
                  <span className="text-meta">
                    {p.method}
                    {p.billNumber ? ` · ${p.billNumber}` : ""}
                  </span>
                </span>
                <b className="tabular-nums">{rupees(p.amount)}</b>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
