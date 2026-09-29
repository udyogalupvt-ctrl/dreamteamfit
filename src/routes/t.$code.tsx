import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  ArrowLeft,
  Dumbbell,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Salad,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { ChatPanel, isUnread, mapThread } from "@/components/portal/chat-panel";
import { PlanContent, PlanHeading, WeekStrip } from "@/components/portal/plan-view";
import {
  BottomNav,
  PortalError,
  PortalGate,
  PortalHeader,
  PortalLoading,
  day,
  daysBetween,
  usePortalData,
  type NavItem,
} from "@/components/portal/portal-shell";
import { VisitsCalendar } from "@/components/portal/visits-calendar";
import { WorkoutDaysEditor, cleanWorkoutDays } from "@/components/plans/workout-days-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PLAN_TEXT_MAX,
  planLines,
  shiftDate,
  type TrainerAssignInput,
  type TrainerMemberDetail,
  type TrainerMemberRow,
  type TrainerPortalData,
} from "@/constants/portal";
import { portalCall, portalDb } from "@/lib/portal-firebase";
import { cn } from "@/lib/utils";
import { DIET_GOALS, WORKOUT_GOALS, type ChatThread, type WorkoutDay } from "@/types/models";

const VIEWS = ["members", "chats"] as const;
type View = (typeof VIEWS)[number];
const MEMBER_TABS = ["plan", "progress", "chat", "info"] as const;
type MemberTab = (typeof MEMBER_TABS)[number];
type Search = { view?: View; member?: string; tab?: MemberTab };

export const Route = createFileRoute("/t/$code")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(VIEWS.includes(s["view"] as View) ? { view: s["view"] as View } : {}),
    ...(typeof s["member"] === "string" && s["member"] ? { member: s["member"] } : {}),
    ...(MEMBER_TABS.includes(s["tab"] as MemberTab) ? { tab: s["tab"] as MemberTab } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Trainer app" },
      { name: "description", content: "Your PT members, their plans and chat." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrainerAppPage,
});

function TrainerAppPage() {
  const { code } = Route.useParams();
  return (
    <PortalGate kind="trainer" code={code}>
      <TrainerApp />
    </PortalGate>
  );
}

function TrainerApp() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const open = (next: Search) => void navigate({ search: next });
  const { data, error, loading, reload } = usePortalData<TrainerPortalData>();
  const [threads, setThreads] = useState<Map<string, ChatThread>>(new Map());
  const trainerId = data?.trainer.id;
  useEffect(() => {
    if (!trainerId) return;
    return onSnapshot(
      query(collection(portalDb, "chats"), where("trainerId", "==", trainerId)),
      (snap) => {
        const m = new Map<string, ChatThread>();
        snap.docs.forEach((d) => {
          const t = mapThread(d);
          if (t) m.set(d.id, t);
        });
        setThreads(m);
      },
      () => undefined,
    );
  }, [trainerId]);

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

  const view = search.view ?? "members";
  const row = search.member ? data.members.find((m) => m.clientId === search.member) : undefined;
  const unread = data.members.filter((m) => isUnread(threads.get(m.clientId) ?? null, "trainer"));
  const items: NavItem<View>[] = [
    { id: "members", label: "My members", icon: Users },
    { id: "chats", label: "Chats", icon: MessageCircle, dot: unread.length > 0 },
  ];

  return (
    <div className="min-h-dvh bg-background pb-24">
      <PortalHeader
        gymName={data.gym.name}
        logoUrl={data.gym.logoUrl}
        title={
          row ? row.name : view === "chats" ? "Chats" : `Hi, ${data.trainer.name.split(" ")[0]}`
        }
        onRefresh={() => void reload()}
        refreshing={loading}
      />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {row ? (
          <MemberDetail
            key={row.clientId}
            row={row}
            data={data}
            tab={search.tab ?? "plan"}
            setTab={(tab) => open({ ...search, tab })}
            back={() => {
              open(view === "chats" ? { view } : {});
              // Today's ticks may have changed while the member was open.
              void reload();
            }}
            onChanged={() => void reload()}
          />
        ) : view === "chats" ? (
          <ChatList
            data={data}
            threads={threads}
            openChat={(id) => open({ view: "chats", member: id, tab: "chat" })}
          />
        ) : (
          <MemberList data={data} threads={threads} openMember={(id) => open({ member: id })} />
        )}
      </main>
      <BottomNav
        items={items}
        value={view}
        onChange={(v) => open(v === "members" ? {} : { view: v })}
      />
    </div>
  );
}

function Ticks({
  done,
  total,
  icon: Icon,
}: {
  done: number;
  total: number;
  icon: typeof Dumbbell;
}) {
  if (!total) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        done >= total
          ? "bg-success/15 text-success"
          : done
            ? "bg-warning/15"
            : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden /> {done}/{total}
    </span>
  );
}

function MemberList({
  data,
  threads,
  openMember,
}: {
  data: TrainerPortalData;
  threads: Map<string, ChatThread>;
  openMember: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = data.members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()));
  if (!data.members.length)
    return (
      <section className="surface-card p-6 text-center">
        <Users className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 font-bold">No PT members right now</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Members show here when the front desk adds PT with you.
        </p>
      </section>
    );
  return (
    <>
      <p className="text-meta">
        {data.members.length} PT member{data.members.length === 1 ? "" : "s"} · ticks are for today
      </p>
      {data.members.length > 6 ? (
        <Input
          aria-label="Search members"
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      ) : null}
      <ul className="space-y-2">
        {list.map((m) => {
          const left = daysBetween(data.today, m.ptEnd);
          return (
            <li key={m.clientId}>
              <button
                type="button"
                onClick={() => openMember(m.clientId)}
                className="surface-card flex w-full cursor-pointer items-center gap-3 p-3 text-left hover:bg-accent/40"
              >
                <ClientAvatar name={m.name} url={m.photoUrl || null} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-bold">{m.name}</span>
                    {isUnread(threads.get(m.clientId) ?? null, "trainer") ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full bg-destructive"
                        aria-label="New message"
                      />
                    ) : null}
                  </span>
                  <span className="text-meta block truncate">
                    {m.ptPackage} · PT {left >= 0 ? `${left} days left` : "ended"}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {m.workoutName ? (
                      <Ticks icon={Dumbbell} {...m.workoutToday} />
                    ) : (
                      <StatusPill tone="warning">No workout plan</StatusPill>
                    )}
                    {m.dietName ? (
                      <Ticks icon={Salad} {...m.dietToday} />
                    ) : (
                      <StatusPill tone="warning">No diet plan</StatusPill>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ChatList({
  data,
  threads,
  openChat,
}: {
  data: TrainerPortalData;
  threads: Map<string, ChatThread>;
  openChat: (id: string) => void;
}) {
  const rows = data.members
    .map((m) => ({ m, t: threads.get(m.clientId) ?? null }))
    .sort((a, b) => (b.t?.lastAt?.getTime() ?? 0) - (a.t?.lastAt?.getTime() ?? 0));
  if (!rows.length) return <p className="text-meta text-center">No PT members to chat with.</p>;
  return (
    <ul className="surface-card divide-y divide-border overflow-hidden">
      {rows.map(({ m, t }) => (
        <li key={m.clientId}>
          <button
            type="button"
            onClick={() => openChat(m.clientId)}
            className="flex w-full cursor-pointer items-center gap-3 p-3 text-left hover:bg-accent/40"
          >
            <ClientAvatar name={m.name} url={m.photoUrl || null} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{m.name}</span>
              <span
                className={cn(
                  "block truncate text-sm",
                  isUnread(t, "trainer") ? "font-semibold" : "text-muted-foreground",
                )}
              >
                {t?.lastText
                  ? `${t.lastFrom === "trainer" ? "You: " : ""}${t.lastText}`
                  : "No messages yet"}
              </span>
            </span>
            {isUnread(t, "trainer") ? (
              <span
                className="size-2.5 shrink-0 rounded-full bg-destructive"
                aria-label="New message"
              />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ one member

function MemberDetail({
  row,
  data,
  tab,
  setTab,
  back,
  onChanged,
}: {
  row: TrainerMemberRow;
  data: TrainerPortalData;
  tab: MemberTab;
  setTab: (t: MemberTab) => void;
  back: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TrainerMemberDetail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<"workout" | "diet" | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      setDetail(
        await portalCall<TrainerMemberDetail>(
          `/api/portal/trainer-member?clientId=${encodeURIComponent(row.clientId)}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [row.clientId]);
  // Fresh each time Plan / Progress / Info opens: the member may have ticked since.
  const needsData = tab !== "chat";
  useEffect(() => {
    if (needsData) void load();
  }, [load, tab, needsData]);

  const tabs: [MemberTab, string][] = [
    ["plan", "Plan"],
    ["progress", "Progress"],
    ["chat", "Chat"],
    ["info", "Info"],
  ];
  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft aria-hidden /> Back
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "cursor-pointer rounded-lg py-2 text-sm font-semibold",
              tab === id ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "chat" ? (
        <ChatPanel
          clientId={row.clientId}
          me="trainer"
          myName={data.trainer.name}
          otherName={row.name.split(" ")[0] || row.name}
          className="h-[calc(100dvh-17.5rem-env(safe-area-inset-bottom))]"
        />
      ) : error ? (
        <PortalError message={error} onRetry={() => void load()} />
      ) : !detail ? (
        <PortalLoading />
      ) : tab === "plan" ? (
        <>
          {(["workout", "diet"] as const).map((kind) => {
            const plan = kind === "workout" ? detail.workout : detail.diet;
            return (
              <section key={kind} className="surface-card overflow-hidden">
                {plan ? (
                  <>
                    <PlanHeading
                      kind={kind}
                      name={plan.name}
                      sub={`${plan.custom ? "Personal plan" : "Gym plan"} · by ${plan.by} · since ${day(plan.startDate)}`}
                    />
                    <div className="border-t border-border p-4">
                      <PlanContent
                        workout={kind === "workout" ? detail.workout : null}
                        diet={kind === "diet" ? detail.diet : null}
                      />
                    </div>
                  </>
                ) : (
                  <PlanHeading
                    kind={kind}
                    name={`No ${kind} plan yet`}
                    sub={`Give ${row.name.split(" ")[0]} a ${kind} plan to tick every day.`}
                  />
                )}
                <div className="border-t border-border p-3">
                  <Button
                    className="w-full"
                    variant={plan ? "outline" : "default"}
                    onClick={() => setEditing(kind)}
                  >
                    {plan ? <Pencil aria-hidden /> : <Plus aria-hidden />}
                    {plan ? `Change ${kind} plan` : `Give ${kind} plan`}
                  </Button>
                </div>
              </section>
            );
          })}
          <PlanEditor
            kind={editing}
            detail={detail}
            templates={data.templates}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
              onChanged();
            }}
          />
        </>
      ) : tab === "progress" ? (
        <>
          <section className="surface-card space-y-3 p-4">
            <h2 className="text-card-title">Last 14 days</h2>
            <WeekStrip
              logs={detail.logs}
              today={detail.today}
              end={shiftDate(detail.today, -7)}
              workout={detail.workout}
              diet={detail.diet}
            />
            <WeekStrip
              logs={detail.logs}
              today={detail.today}
              workout={detail.workout}
              diet={detail.diet}
            />
            <p className="text-meta">
              Workout ✓ = ticked at least one exercise that day. Meals = meals ticked.
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-card-title">Visits (last 60 days: {detail.visits.length})</h2>
            <VisitsCalendar visits={detail.visits} today={detail.today} />
          </section>
        </>
      ) : (
        <section className="surface-card space-y-4 p-4">
          <div className="flex items-center gap-3">
            <ClientAvatar
              name={detail.member.name}
              url={detail.member.photoUrl || null}
              size={64}
            />
            <div className="min-w-0">
              <p className="text-card-title">{detail.member.name}</p>
              <p className="text-meta">
                Member ID {detail.member.memberId || "—"}
                {detail.member.age ? ` · ${detail.member.age} years` : ""}
                {detail.member.gender && detail.member.gender !== "unspecified"
                  ? ` · ${detail.member.gender}`
                  : ""}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-meta">PT package</dt>
              <dd className="font-semibold">{detail.pt.packageName}</dd>
            </div>
            <div>
              <dt className="text-meta">PT dates</dt>
              <dd className="font-semibold">
                {day(detail.pt.startDate)} → {day(detail.pt.endDate)}
              </dd>
            </div>
            <div>
              <dt className="text-meta">Gym package</dt>
              <dd className="font-semibold">{detail.membership?.packageName || "—"}</dd>
            </div>
            <div>
              <dt className="text-meta">Gym package ends</dt>
              <dd className="font-semibold">{day(detail.membership?.endDate)}</dd>
            </div>
          </dl>
          {detail.member.phone ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={`tel:${detail.member.phone}`}>
                  <Phone aria-hidden /> Call
                </a>
              </Button>
              <Button variant="outline" onClick={() => setTab("chat")}>
                <MessageCircle aria-hidden /> Chat in app
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ plan editor

type Draft = {
  from: string;
  name: string;
  goal: string;
  weeks: number;
  description: string;
  notes: string;
  days: WorkoutDay[];
  calories: number;
  meals: string;
};

function PlanEditor({
  kind,
  detail,
  templates,
  onClose,
  onSaved,
}: {
  kind: "workout" | "diet" | null;
  detail: TrainerMemberDetail;
  templates: TrainerPortalData["templates"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const first = detail.member.name.split(" ")[0] || detail.member.name;

  /** Where the draft can start from: this member's current plan, blank, or a gym plan. */
  const sources = useMemo(() => {
    if (kind === "workout")
      return [
        ...(detail.workout
          ? [{ id: "current", label: `Current plan: ${detail.workout.name}` }]
          : []),
        { id: "blank", label: "Start blank" },
        ...templates.workout.map((t) => ({ id: t.id, label: `Gym plan: ${t.name}` })),
      ];
    return [
      ...(detail.diet ? [{ id: "current", label: `Current plan: ${detail.diet.name}` }] : []),
      { id: "blank", label: "Start blank" },
      ...templates.diet.map((t) => ({ id: t.id, label: `Gym plan: ${t.name}` })),
    ];
  }, [kind, detail, templates]);

  const draftFrom = useCallback(
    (from: string): Draft => {
      const blank: Draft = {
        from,
        name: kind === "workout" ? `${first}'s workout` : `${first}'s diet`,
        goal: "General Fitness",
        weeks: 4,
        description: "",
        notes: "",
        days: [{ title: "Day 1", exercises: "" }],
        calories: 0,
        meals: "",
      };
      const weeksOf = (a: string, b: string) =>
        Math.max(1, Math.round(Math.max(7, daysBetween(a, b)) / 7));
      if (kind === "workout") {
        const w = detail.workout;
        if (from === "current" && w)
          return {
            ...blank,
            name: w.name,
            goal: w.goal || blank.goal,
            weeks: weeksOf(w.startDate, w.endDate),
            description: w.description,
            notes: w.notes,
            days: w.days.length ? w.days : blank.days,
          };
        const t = templates.workout.find((x) => x.id === from);
        if (t)
          return {
            ...blank,
            name: `${t.name} (${first})`,
            goal: t.goal || blank.goal,
            weeks: t.durationWeeks,
            description: t.description,
            days: t.days.length ? t.days : blank.days,
          };
        return blank;
      }
      const d = detail.diet;
      if (from === "current" && d)
        return {
          ...blank,
          name: d.name,
          goal: d.goal || blank.goal,
          weeks: weeksOf(d.startDate, d.endDate),
          description: d.description,
          notes: d.notes,
          calories: d.calories,
          meals: d.meals,
        };
      const t = templates.diet.find((x) => x.id === from);
      if (t)
        return {
          ...blank,
          name: `${t.name} (${first})`,
          goal: t.goal || blank.goal,
          description: t.description,
          calories: t.dailyCalories,
          meals: t.mealStructure,
        };
      return blank;
    },
    [kind, detail, templates, first],
  );

  useEffect(() => {
    if (!kind) return setF(null);
    setError("");
    setF(draftFrom(sources[0]?.id ?? "blank"));
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!f || !kind) return;
    if (f.name.trim().length < 2) return setError("Give the plan a name.");
    const days = cleanWorkoutDays(f.days);
    if (kind === "workout" && !days.some((d) => planLines(d.exercises).length))
      return setError("Add at least one exercise.");
    if (kind === "diet" && !planLines(f.meals).length) return setError("Add at least one meal.");
    setSaving(true);
    setError("");
    const common = {
      clientId: detail.member.id,
      name: f.name.trim(),
      goal: f.goal,
      description: f.description,
      notes: f.notes,
      weeks: f.weeks,
    };
    const body: TrainerAssignInput =
      kind === "workout"
        ? { ...common, kind, days }
        : { ...common, kind, calories: f.calories, meals: f.meals };
    try {
      await portalCall("/api/portal/trainer-assign", body);
      toast.success(`${kind === "workout" ? "Workout" : "Diet"} plan given to ${first}`, {
        description: "It shows in their member app now.",
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const goals = kind === "diet" ? DIET_GOALS : WORKOUT_GOALS;
  return (
    <FormDialog
      open={!!kind && !!f}
      onOpenChange={(o) => !o && onClose()}
      title={kind === "diet" ? `Diet plan for ${first}` : `Workout plan for ${first}`}
      description="Saving replaces the current plan; the old one stays in their history."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save & give plan
          </Button>
        </>
      }
    >
      {f ? (
        <div className="grid gap-4">
          {error ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <Field label="Start from" htmlFor="pe-from">
            <Select value={f.from} onValueChange={(v) => setF(draftFrom(v))}>
              <SelectTrigger id="pe-from" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Plan name" htmlFor="pe-name" required>
            <Input
              id="pe-name"
              maxLength={80}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Goal" htmlFor="pe-goal">
              <Select value={f.goal} onValueChange={(v) => setF({ ...f, goal: v })}>
                <SelectTrigger id="pe-goal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...goals, f.goal])].map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="For how many weeks" htmlFor="pe-weeks">
              <Input
                id="pe-weeks"
                type="number"
                inputMode="numeric"
                min={1}
                max={52}
                value={f.weeks}
                onChange={(e) => setF({ ...f, weeks: Number(e.target.value) })}
              />
            </Field>
          </div>
          {kind === "workout" ? (
            <WorkoutDaysEditor
              days={f.days}
              onChange={(days) => setF({ ...f, days })}
              idPrefix="pe"
            />
          ) : (
            <>
              <Field label="Calories a day" htmlFor="pe-cal" hint="0 = don't show">
                <Input
                  id="pe-cal"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20000}
                  value={f.calories}
                  onChange={(e) => setF({ ...f, calories: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Meals (one per line)"
                htmlFor="pe-meals"
                hint={`${planLines(f.meals).length} meals · ${first} ticks each one daily`}
              >
                <Textarea
                  id="pe-meals"
                  rows={7}
                  maxLength={PLAN_TEXT_MAX}
                  value={f.meals}
                  placeholder={
                    "7 AM · 4 egg whites + oats\n11 AM · Fruit + nuts\n1 PM · Rice, dal, chicken\n5 PM · Sprouts\n8 PM · Chapati + paneer"
                  }
                  onChange={(e) => setF({ ...f, meals: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="About this plan" htmlFor="pe-desc">
            <Textarea
              id="pe-desc"
              rows={2}
              maxLength={1000}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
          <Field label={`Note for ${first}`} htmlFor="pe-notes">
            <Textarea
              id="pe-notes"
              rows={2}
              maxLength={1000}
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </FormDialog>
  );
}
