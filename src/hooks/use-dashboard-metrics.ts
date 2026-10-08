import { useEffect, useMemo, useState } from "react";
import { plansForLists, type PlanRow } from "@/lib/member-plans";
import { addDays, format, formatDistanceToNow, startOfMonth } from "date-fns";
import {
  BadgeIndianRupee,
  Cake,
  CalendarCheck,
  CalendarClock,
  CreditCard,
  ReceiptIndianRupee,
  Dumbbell,
  MessageSquareHeart,
  RefreshCcw,
  Salad,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
  UsersRound,
} from "lucide-react";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import {
  effectiveMembershipStatus,
  formatDateISO,
  formatNumber,
  formatPrice,
  formatTime,
  joinedOnOf,
  todayISO,
} from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribeQueuedPlans, subscribeRecentMemberships } from "@/services/memberships.service";
import { subscribeWorkoutAssignments } from "@/services/workout-assignments.service";
import { subscribeDietAssignments } from "@/services/diet-assignments.service";
import { subscribeBookings } from "@/services/bookings.service";
import { subscribeGroupClasses } from "@/services/group-classes.service";
import { subscribeClassEnrollments } from "@/services/class-enrollments.service";
import { subscribeExpenseActivities, subscribeExpensesSince } from "@/services/expenses.service";
import {
  subscribeInvoicesSince,
  subscribeDueInvoices,
  subscribeRecentInvoices,
} from "@/services/invoices.service";
import type { ActivityItem, StatMetric } from "@/types";
import type {
  AttendanceEvent,
  AutomationActivity,
  Booking,
  ClassEnrollment,
  Client,
  DietAssignment,
  Expense,
  ExpenseActivity,
  FollowUp,
  GroupClass,
  Inquiry,
  Invoice,
  Membership,
  WorkoutAssignment,
} from "@/types/models";
import { attendanceCounts, subscribeAttendanceDay } from "@/services/attendance.service";
import { subscribeFollowUps } from "@/services/followups.service";
import { subscribeAutomationActivities } from "@/services/notifications.service";
import { attendanceSummary } from "@/lib/attendance-utils";
import {
  buildFinanceSummary,
  subscribeManualIncomeSince,
  subscribePaymentsSince,
  allTimeCollected,
} from "@/services/finance.service";
import type { ManualIncome, Payment } from "@/types/models";

/** The dashboard's period ("Showing: Today / Last 5 days / a date / a range"). */
export interface DashboardPeriod {
  from: string;
  to: string;
  /** "today", "last 5 days", "12 Sep 2026", "1 Sep – 15 Sep 2026"… */
  label: string;
  isToday: boolean;
}
export const TODAY_PERIOD = (): DashboardPeriod => ({
  from: todayISO(),
  to: todayISO(),
  label: "today",
  isToday: true,
});

/** One line of a money list: a payment (or an old bill paid before payments were recorded). */
export interface MoneyRow {
  id: string;
  clientId: string;
  name: string;
  date: string;
  at: Date;
  amount: number;
  method: string;
  /** old = paid in the old software (counted on its day, no bill here, not in the drawer). */
  kind: "initial" | "balance" | "refund" | "bill" | "old";
  bill: string;
}
/** One line of a "more numbers" card's list. */
export interface DetailRow {
  id: string;
  title: string;
  sub: string;
  right?: string;
  /** Shown in red (money going out). */
  minus?: boolean;
  /** Tapping the line opens this member. */
  clientId?: string;
}
/** The list behind one of the "more numbers" cards. */
export interface DetailList {
  summary: string;
  rows: DetailRow[];
  /** Totals by kind, e.g. expenses by category. */
  chips?: [string, string][];
}

/** A member with a running plan, for the "Active members" list. */
export interface ActiveRow {
  clientId: string;
  name: string;
  code: string;
  plan: string;
  endDate: string;
}

/** " · after ₹2,000 refunded" when money was given back (Collected is after refunds). */
const refundedNote = (m: { refunded: number }) =>
  m.refunded > 0 ? ` · after ${formatPrice(m.refunded)} refunded` : "";

/**
 * A one-off database sum that failed (a dropped connection right after sign-in, the database
 * busy) is tried again by itself: 2 s, 5 s, 15 s, 30 s, 60 s. It used to stay on "…" until a
 * refresh. Returns a stop function for the effect cleanup.
 */
function loadWithRetry<T>(load: () => Promise<T>, done: (v: T) => void) {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = (tries: number) =>
    void load().then(
      (v) => live && done(v),
      () => {
        if (live && tries < 5)
          timer = setTimeout(() => attempt(tries + 1), [2000, 5000, 15000, 30000, 60000][tries]);
      },
    );
  attempt(0);
  return () => {
    live = false;
    clearTimeout(timer);
  };
}

/** Derives dashboard numbers from live Firestore data only — nothing is invented. */
export function useDashboardMetrics(period: DashboardPeriod = TODAY_PERIOD()) {
  // Staff without the finance feature never load expenses (Firestore rules would refuse).
  const finance = useAccess().can("finance");
  const clients = useLive<Client[]>(subscribeClients, [], []);
  // Counts come from each member's current plan + plans waiting to start; the feed shows the
  // 8 newest plans. Not every plan ever sold.
  const queued = useLive<Membership[]>(subscribeQueuedPlans, [], []);
  const recentPlans = useLive<Membership[]>(subscribeRecentMemberships, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const workouts = useLive<WorkoutAssignment[]>(subscribeWorkoutAssignments, [], []);
  const diets = useLive<DietAssignment[]>(subscribeDietAssignments, [], []);
  const bookings = useLive<Booking[]>(subscribeBookings, [], []);
  const classes = useLive<GroupClass[]>(subscribeGroupClasses, [], []);
  const enrollments = useLive<ClassEnrollment[]>(subscribeClassEnrollments, [], []);
  // Money: only this month's records, the open bills and the newest bills are loaded (not every
  // bill / payment ever, which grows each month); the all-time total is added up by the database.
  // A period before this month (a picked date / range) loads from its first day.
  const monthFrom = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const loadFrom = period.from < monthFrom ? period.from : monthFrom;
  const expenses = useLive<Expense[]>(
    finance ? (ok, fail) => subscribeExpensesSince(loadFrom, ok, fail) : null,
    [],
    [finance, loadFrom],
  );
  const expenseActivities = useLive<ExpenseActivity[]>(
    finance ? subscribeExpenseActivities : null,
    [],
    [finance],
  );
  const invoices = useLive<Invoice[]>(subscribeRecentInvoices, [], []);
  const openInvoices = useLive<Invoice[]>(subscribeDueInvoices, [], []);
  const monthInvoices = useLive<Invoice[]>(
    (ok, fail) => subscribeInvoicesSince(loadFrom, ok, fail),
    [],
    [loadFrom],
  );
  // Visits over several days: counted by the database (about 1 read per 1,000 punches).
  const [rangeVisits, setRangeVisits] = useState<number | null>(null);
  useEffect(() => {
    setRangeVisits(null);
    if (period.isToday) return;
    return loadWithRetry(
      () => attendanceCounts(period.from, period.to),
      (v) => setRangeVisits(v.visits),
    );
  }, [period.from, period.to, period.isToday]);
  const [allTime, setAllTime] = useState<number | null>(null);
  useEffect(() => loadWithRetry(allTimeCollected, setAllTime), []);
  // Only today's visits are shown here.
  const today = todayISO();
  const attendance = useLive<AttendanceEvent[]>(
    (ok, fail) => subscribeAttendanceDay(today, ok, fail),
    [],
    [today],
  );
  const followUps = useLive<FollowUp[]>(subscribeFollowUps, [], []);
  const automationActivities = useLive<AutomationActivity[]>(subscribeAutomationActivities, [], []);
  const payments = useLive<Payment[]>(
    (ok, fail) => subscribePaymentsSince(loadFrom, ok, fail),
    [],
    [loadFrom],
  );
  const manualIncome = useLive<ManualIncome[]>(
    finance ? (ok, fail) => subscribeManualIncomeSince(loadFrom, ok, fail) : null,
    [],
    [finance, loadFrom],
  );

  const loading =
    payments.loading ||
    clients.loading ||
    queued.loading ||
    inquiries.loading ||
    workouts.loading ||
    diets.loading ||
    bookings.loading ||
    classes.loading ||
    enrollments.loading ||
    expenses.loading ||
    expenseActivities.loading ||
    invoices.loading ||
    openInvoices.loading ||
    monthInvoices.loading ||
    attendance.loading ||
    followUps.loading ||
    automationActivities.loading;
  const error =
    payments.error ??
    manualIncome.error ??
    clients.error ??
    queued.error ??
    inquiries.error ??
    workouts.error ??
    diets.error ??
    bookings.error ??
    classes.error ??
    enrollments.error ??
    expenses.error ??
    expenseActivities.error ??
    invoices.error ??
    openInvoices.error ??
    monthInvoices.error ??
    attendance.error ??
    followUps.error ??
    automationActivities.error;

  const result = useMemo(() => {
    const today = todayISO();
    const in7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
    const monthStart = startOfMonth(new Date());
    const monthStartISO = format(monthStart, "yyyy-MM-dd");
    const todayExpenses = expenses.data
      .filter((item) => item.date === today)
      .reduce((sum, item) => sum + item.amount, 0);
    const monthExpenses = expenses.data
      .filter((item) => item.date >= monthStartISO && item.date <= today)
      .reduce((sum, item) => sum + item.amount, 0);
    // Money comes from payment records (by payment date), so a balance paid today counts today.
    const expenseRows = expenses.data.map((e) => ({ amount: e.amount, date: e.date }));
    const todayMoney = buildFinanceSummary(
      payments.data,
      monthInvoices.data,
      manualIncome.data,
      expenseRows,
      today,
      today,
    );
    const monthMoney = buildFinanceSummary(
      payments.data,
      monthInvoices.data,
      manualIncome.data,
      expenseRows,
      monthStartISO,
      today,
    );
    // The period picked on the dashboard (today by default).
    const periodMoney = period.isToday
      ? todayMoney
      : buildFinanceSummary(
          payments.data,
          monthInvoices.data,
          manualIncome.data,
          expenseRows,
          period.from,
          period.to,
        );
    const periodExpenses = expenses.data
      .filter((item) => item.date >= period.from && item.date <= period.to)
      .reduce((sum, item) => sum + item.amount, 0);
    // By the day they joined the gym (members moved from the old software keep their old date).
    const joinedIn = (from: string, to: string) =>
      clients.data.filter((c) => {
        const d = joinedOnOf(c);
        return d >= from && d <= to;
      }).length;
    // Today keeps the month view for the "more numbers" (profit, expenses…); a picked period
    // shows that period.
    const statMoney = period.isToday ? monthMoney : periodMoney;
    const statExpenses = period.isToday ? monthExpenses : periodExpenses;
    const statLabel = period.isToday ? "this month" : period.label;
    const totalCollected = allTime;
    const todayCollected = periodMoney.gross;
    const monthCollected = monthMoney.gross;
    const outstanding = openInvoices.data
      .filter((item) => item.paymentStatus !== "refunded")
      .reduce((sum, item) => sum + item.balanceDue, 0);
    const attendanceToday = attendance.data.filter((item) => item.attendanceDate === today);
    const attendanceTotals = attendanceSummary(attendanceToday);

    const byClient = new Map<string, PlanRow[]>();
    plansForLists(clients.data, queued.data).forEach((m) => {
      const list = byClient.get(m.clientId) ?? [];
      list.push(m);
      byClient.set(m.clientId, list);
    });

    let active = 0;
    let expired = 0;
    let renewals = 0;
    let expiringToday = 0;
    let expiringIn7Days = 0;
    const clientById = new Map(clients.data.map((c) => [c.id, c]));
    const activeRows: ActiveRow[] = [];
    const renewalRows: ActiveRow[] = [];
    const expiredRows: ActiveRow[] = [];
    byClient.forEach((list, clientId) => {
      const statuses = list.map((m) => ({ m, s: effectiveMembershipStatus(m) }));
      const current = statuses.find((x) => x.s === "active");
      if (current) {
        active += 1;
        const c = clientById.get(clientId);
        activeRows.push({
          clientId,
          name: c?.fullName ?? "",
          code: c?.clientCode ?? "",
          plan: current.m.packageNameSnapshot,
          endDate: current.m.endDate,
        });
        if (current.m.endDate <= in7) {
          renewals += 1;
          renewalRows.push(activeRows[activeRows.length - 1]!);
        }
        if (current.m.endDate === today) expiringToday += 1;
        if (current.m.endDate === in7) expiringIn7Days += 1;
      } else if (
        !statuses.some((x) => x.s === "pending") &&
        statuses.some((x) => x.s === "expired")
      ) {
        expired += 1;
        const last = statuses
          .filter((x) => x.s === "expired")
          .sort((a, b) => b.m.endDate.localeCompare(a.m.endDate))[0]!.m;
        const c = clientById.get(clientId);
        expiredRows.push({
          clientId,
          name: c?.fullName ?? "",
          code: c?.clientCode ?? "",
          plan: last.packageNameSnapshot,
          endDate: last.endDate,
        });
      }
    });

    const newClients = period.isToday
      ? joinedIn(format(monthStart, "yyyy-MM-dd"), today)
      : joinedIn(period.from, period.to);
    const withDob = clients.data.filter((c) => c.dateOfBirth);
    const birthdays = withDob.filter((c) => c.dateOfBirth!.slice(5) === today.slice(5)).length;
    const followUpsDue = followUps.data.filter(
      (item) => item.status === "pending" && item.followUpDate <= today,
    ).length;

    const visitsToday = attendanceTotals.visits;
    const primary: StatMetric[] = [
      {
        id: "today-collection",
        label: period.isToday ? "Collected today" : `Collected · ${period.label}`,
        value: formatPrice(todayCollected),
        hint:
          (period.isToday
            ? "all payments received today"
            : `gym income ${formatPrice(periodMoney.gymIncome)}`) + refundedNote(periodMoney),
        icon: BadgeIndianRupee,
        tone: "success",
      },
      {
        id: "month-collection",
        label: "This month",
        value: formatPrice(monthCollected),
        hint: `gym income ${formatPrice(monthMoney.gymIncome)}${refundedNote(monthMoney)}`,
        icon: BadgeIndianRupee,
        tone: "primary",
      },
      {
        id: "active",
        label: "Active members",
        value: formatNumber(active),
        hint: `${formatNumber(newClients)} joined ${statLabel}`,
        icon: UserRoundCheck,
        tone: "info",
      },
      period.isToday
        ? {
            id: "attendance",
            label: "Visits today",
            value: formatNumber(visitsToday),
            hint: `${attendanceTotals.present} inside now · ${attendanceTotals.blocked} blocked`,
            icon: CalendarCheck,
            tone: "violet",
          }
        : {
            id: "attendance",
            label: `Punches · ${period.label}`,
            value: rangeVisits === null ? "…" : formatNumber(rangeVisits),
            hint: "fingerprint punches (going in again counts again)",
            icon: CalendarCheck,
            tone: "violet",
          },
    ];

    const FINANCE_ONLY = new Set([
      "profit-loss",
      "month-expenses",
      "trainer-payable",
      "collection",
    ]);
    const allStats: StatMetric[] = [
      {
        id: "profit-loss",
        label: `Profit ${statLabel}`,
        value: formatPrice(statMoney.net),
        hint: "gym income − expenses (trainer share excluded)",
        icon: BadgeIndianRupee,
        tone: statMoney.net >= 0 ? "success" : "danger",
      },
      {
        id: "month-expenses",
        label: `Expenses ${statLabel}`,
        value: formatPrice(statExpenses),
        hint: period.isToday ? `${formatPrice(todayExpenses)} today` : "paid in this period",
        icon: ReceiptIndianRupee,
        tone: "warning",
      },
      {
        id: "trainer-payable",
        label: `Trainer share ${statLabel}`,
        value: formatPrice(statMoney.trainerPayable),
        hint: "owed to trainers from PT",
        icon: Dumbbell,
        tone: "info",
      },
      {
        id: "outstanding",
        label: "Balance due",
        value: formatPrice(outstanding),
        hint: "unpaid on bills",
        icon: CreditCard,
        tone: "warning",
      },
      {
        id: "collection",
        label: "Total collected",
        value: totalCollected === null ? "…" : formatPrice(totalCollected),
        hint: "all time",
        icon: BadgeIndianRupee,
        tone: "success",
      },
      {
        id: "new-clients",
        label: "New members",
        value: formatNumber(newClients),
        hint: statLabel,
        icon: UserPlus,
        tone: "primary",
      },
      {
        id: "expired",
        label: "Expired members",
        value: formatNumber(expired),
        hint: "no running plan",
        icon: UserRoundX,
        tone: "danger",
      },
      {
        id: "renewals",
        label: "Ending in 7 days",
        value: formatNumber(renewals),
        hint: "renewals coming up",
        icon: RefreshCcw,
        tone: "info",
      },
      {
        id: "follow-ups",
        label: "Calls due",
        value: formatNumber(followUpsDue),
        hint: "follow-ups due today or overdue",
        icon: MessageSquareHeart,
        tone: "warning",
      },
      {
        id: "pt-today",
        label: "PT sessions today",
        value: formatNumber(
          bookings.data.filter(
            (item) =>
              item.bookingType === "pt" && item.status === "scheduled" && item.date === today,
          ).length,
        ),
        hint: `${formatNumber(bookings.data.filter((item) => item.bookingType === "pt" && item.status === "scheduled" && item.date > today).length)} upcoming`,
        icon: Dumbbell,
        tone: "primary",
      },
      {
        id: "group-booked",
        label: "Class bookings",
        value: formatNumber(enrollments.data.filter((item) => item.status === "enrolled").length),
        hint: "active enrollments",
        icon: UsersRound,
        tone: "info",
      },
      {
        id: "today-schedule",
        label: "Today's schedule",
        value: formatNumber(
          bookings.data.filter((item) => item.date === today && item.status === "scheduled")
            .length +
            classes.data.filter((item) => item.date === today && item.status === "scheduled")
              .length,
        ),
        hint: "bookings and classes",
        icon: CalendarClock,
        tone: "warning",
      },
      {
        id: "birthdays",
        label: "Birthdays today",
        value: formatNumber(birthdays),
        hint: birthdays ? "send wishes" : "none today",
        icon: Cake,
        tone: "violet",
      },
      {
        id: "plans",
        label: "Workout / diet plans",
        value: `${formatNumber(workouts.data.filter((item) => item.status === "active").length)} / ${formatNumber(diets.data.filter((item) => item.status === "active").length)}`,
        hint: "currently assigned",
        icon: Salad,
        tone: "success",
      },
    ];

    const stats = finance ? allStats : allStats.filter((s) => !FINANCE_ONLY.has(s.id));

    const totalInquiries = inquiries.data.length;
    const converted = inquiries.data.filter((i) => i.convertedToClient).length;
    const ratios = [
      {
        label: "Inquiry conversion",
        pct: totalInquiries ? Math.round((converted / totalInquiries) * 100) : null,
        tone: "bg-success",
      },
      {
        label: "Active member ratio",
        pct: clients.data.length ? Math.round((active / clients.data.length) * 100) : null,
        tone: "bg-info",
      },
      {
        label: "Renewals due (of active)",
        pct: active ? Math.round((renewals / active) * 100) : null,
        tone: "bg-warning",
      },
    ];

    const clientName = new Map(clients.data.map((c) => [c.id, c.fullName]));
    const activity: (ActivityItem & { at: Date })[] = [
      ...clients.data.slice(0, 8).map((c) => ({
        id: `c-${c.id}`,
        title: `${c.fullName} joined as a member`,
        description: `${c.clientCode}${c.inquiryId ? " · converted from inquiry" : ""}`,
        at: c.createdAt,
        tone: "primary" as const,
        icon: Users,
      })),
      ...inquiries.data.slice(0, 8).map((i) => ({
        id: `i-${i.id}`,
        title: `New inquiry from ${i.name}`,
        description: i.fitnessGoal || "No goal noted",
        at: i.createdAt,
        tone: "warning" as const,
        icon: UserPlus,
      })),
      ...recentPlans.data.slice(0, 8).map((m) => ({
        id: `m-${m.id}`,
        title: `${clientName.get(m.clientId) ?? "Client"} started ${m.packageNameSnapshot}`,
        description: `Ends ${m.endDate}`,
        at: m.createdAt,
        tone: "success" as const,
        icon: CreditCard,
      })),
      ...workouts.data.slice(0, 8).map((item) => ({
        id: `w-${item.id}`,
        title: `${clientName.get(item.clientId) ?? "Client"} received ${item.planNameSnapshot}`,
        description: `Workout · ${item.goalSnapshot}`,
        at: item.createdAt,
        tone: "primary" as const,
        icon: Dumbbell,
      })),
      ...diets.data.slice(0, 8).map((item) => ({
        id: `d-${item.id}`,
        title: `${clientName.get(item.clientId) ?? "Client"} received ${item.planNameSnapshot}`,
        description: `Diet · ${item.goalSnapshot}`,
        at: item.createdAt,
        tone: "success" as const,
        icon: Salad,
      })),
      ...bookings.data.slice(0, 8).map((item) => ({
        id: `booking-${item.id}`,
        title: `${item.clientNameSnapshot || "Group class"} booking`,
        description: `${item.date} · ${item.startTime} · ${item.status.replace("_", "-")}`,
        at: item.updatedAt,
        tone: "warning" as const,
        icon: CalendarClock,
      })),
      ...expenseActivities.data.slice(0, 8).map((item) => ({
        id: `expense-${item.id}`,
        title:
          item.action === "created"
            ? "Expense added"
            : item.action === "updated"
              ? "Expense updated"
              : "Expense removed",
        description: `${item.expenseTitleSnapshot} · ${item.createdBy}`,
        at: item.createdAt,
        tone: item.action === "deleted" ? ("danger" as const) : ("warning" as const),
        icon: ReceiptIndianRupee,
      })),
      ...invoices.data.slice(0, 8).map((item) => ({
        id: `invoice-${item.id}`,
        title: `${item.invoiceNumber} generated`,
        description: `${item.clientNameSnapshot} · ${formatPrice(item.amountPaid)} collected`,
        at: item.createdAt,
        tone: "success" as const,
        icon: BadgeIndianRupee,
      })),
      ...automationActivities.data.slice(0, 8).map((item) => ({
        id: `automation-${item.id}`,
        title: item.description,
        description: item.clientNameSnapshot,
        at: item.createdAt,
        tone: item.type === "automation_failed" ? ("danger" as const) : ("warning" as const),
        icon: MessageSquareHeart,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6)
      .map((a) => ({ ...a, time: formatDistanceToNow(a.at, { addSuffix: true }) }));

    const todaySchedule = [
      ...bookings.data
        .filter((item) => item.date === today && item.status === "scheduled")
        .map((item) => ({
          id: `booking-${item.id}`,
          time: item.startTime,
          title: item.clientNameSnapshot || "Group class booking",
          detail: item.trainerNameSnapshot
            ? `Trainer ${item.trainerNameSnapshot}`
            : item.bookingType.replace("_", " "),
        })),
      ...classes.data
        .filter((item) => item.date === today && item.status === "scheduled")
        .map((item) => ({
          id: `class-${item.id}`,
          time: item.startTime,
          title: item.name,
          detail: `${item.bookedCount}/${item.capacity} booked · Trainer ${item.trainerNameSnapshot}`,
        })),
    ].sort((a, b) => a.time.localeCompare(b.time));

    // What the money cards add up (same records as Collected): newest first.
    const moneyRows = (from: string, to: string): MoneyRow[] =>
      [
        ...payments.data
          .filter((p) => p.paymentDate >= from && p.paymentDate <= to)
          .map((p) => ({
            id: p.id,
            clientId: p.clientId,
            name: p.clientNameSnapshot,
            date: p.paymentDate,
            at: p.createdAt,
            amount: p.amount,
            method: p.method,
            kind: p.oldSoftware ? ("old" as const) : p.kind,
            bill: p.oldSoftware
              ? p.oldSoftwareBillNo
                ? `old bill ${p.oldSoftwareBillNo}`
                : ""
              : p.invoiceNumber,
          })),
        ...monthInvoices.data
          .filter(
            (i) =>
              !i.paymentsTracked &&
              i.amountPaid > 0 &&
              i.invoiceDate >= from &&
              i.invoiceDate <= to,
          )
          .map((i) => ({
            id: `bill-${i.id}`,
            clientId: i.clientId,
            name: i.clientNameSnapshot,
            date: i.invoiceDate,
            at: i.createdAt,
            amount: i.amountPaid,
            method: i.paymentMethod,
            kind: "bill" as const,
            bill: i.invoiceNumber,
          })),
      ].sort((a, b) => b.date.localeCompare(a.date) || b.at.getTime() - a.at.getTime());

    return {
      primary,
      stats,
      ratios,
      activity,
      todaySchedule,
      retention: { expiringToday, expiringIn7Days, expired, birthdays },
      // The lists behind the four number cards (tap a card to see them).
      lists: {
        period: moneyRows(period.from, period.to),
        month: moneyRows(monthStartISO, today),
        active: activeRows.sort(
          (a, b) => a.endDate.localeCompare(b.endDate) || a.name.localeCompare(b.name),
        ),
        visitsToday: attendanceToday,
        more: moreLists(),
      },
    };

    /** The lists behind the "more numbers" cards, from what is already loaded. */
    function moreLists(): Record<string, DetailList> {
      const from = period.isToday ? monthStartISO : period.from;
      const to = period.isToday ? today : period.to;
      const signed = (n: number) => (n < 0 ? `−${formatPrice(-n)}` : formatPrice(n));
      const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const memberRow = (r: ActiveRow, sub: string, right?: string): DetailRow => ({
        id: r.clientId,
        title: r.name || "Member",
        sub,
        ...(right ? { right } : {}),
        clientId: r.clientId,
      });
      const spent = expenses.data
        .filter((e) => e.date >= from && e.date <= to)
        .sort((a, b) => b.date.localeCompare(a.date));
      const byCategory = new Map<string, number>();
      spent.forEach((e) =>
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount),
      );
      const shares = payments.data
        .filter((p) => p.paymentDate >= from && p.paymentDate <= to && p.trainerShareAmount !== 0)
        .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
      const oldShares = shares
        .filter((p) => p.oldSoftware)
        .reduce((n, p) => n + p.trainerShareAmount, 0);
      const due = openInvoices.data
        .filter((i) => i.paymentStatus !== "refunded" && i.balanceDue > 0)
        .sort((a, b) => (a.dueDate || "9").localeCompare(b.dueDate || "9"));
      const joined = clients.data
        .filter((c) => {
          const d = joinedOnOf(c);
          return d >= from && d <= to;
        })
        .sort(
          (a, b) =>
            joinedOnOf(b).localeCompare(joinedOnOf(a)) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );
      const calls = followUps.data
        .filter((f) => f.status === "pending" && f.followUpDate <= today)
        .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
      const pt = bookings.data
        .filter((b) => b.bookingType === "pt" && b.status === "scheduled" && b.date === today)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      const classById = new Map(classes.data.map((g) => [g.id, g]));
      const enrolled = enrollments.data.filter((e) => e.status === "enrolled");
      const bdays = withDob.filter((c) => c.dateOfBirth!.slice(5) === today.slice(5));
      const plansOn = [
        ...workouts.data
          .filter((w) => w.status === "active")
          .map((w) => ({
            id: w.id,
            clientId: w.clientId,
            kind: "Workout",
            name: w.planNameSnapshot,
          })),
        ...diets.data
          .filter((x) => x.status === "active")
          .map((x) => ({ id: x.id, clientId: x.clientId, kind: "Diet", name: x.planNameSnapshot })),
      ];
      return {
        "profit-loss": {
          summary: `${signed(statMoney.net)} profit ${statLabel}`,
          rows: [
            {
              id: "in",
              title: "Collected",
              sub: "all payments received",
              right: signed(statMoney.gross),
            },
            {
              id: "trainer",
              title: "Trainer share",
              sub: "owed to trainers from PT, not the gym's money",
              right: signed(-statMoney.trainerPayable),
              minus: true,
            },
            ...(statMoney.manualIncome
              ? [
                  {
                    id: "other",
                    title: "Other income",
                    sub: "entered by hand",
                    right: signed(statMoney.manualIncome),
                  },
                ]
              : []),
            {
              id: "out",
              title: "Expenses",
              sub: count(spent.length, "expense"),
              right: signed(-statExpenses),
              minus: true,
            },
            {
              id: "net",
              title: "Profit",
              sub: "gym income − expenses",
              right: signed(statMoney.net),
            },
          ],
        },
        "month-expenses": {
          summary: `${formatPrice(statExpenses)} · ${count(spent.length, "expense")} ${statLabel}`,
          chips: [...byCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]): [string, string] => [k, formatPrice(v)]),
          rows: spent.map((e) => ({
            id: e.id,
            title: e.title,
            sub: `${formatDateISO(e.date)} · ${e.category} · ${e.paymentMethod}`,
            right: formatPrice(e.amount),
          })),
        },
        "trainer-payable": {
          summary: `${signed(statMoney.trainerPayable)} owed to trainers ${statLabel}${
            oldShares ? ` (${formatPrice(oldShares)} of it settled in the old software)` : ""
          }`,
          rows: shares.map((p) => ({
            id: p.id,
            title: p.clientNameSnapshot || "Member",
            sub: `${formatDateISO(p.paymentDate)}${p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}${p.kind === "refund" ? " · refund" : ""}${p.oldSoftware ? " · paid in the old software, trainer settled there" : ""}`,
            right: signed(p.trainerShareAmount),
            minus: p.trainerShareAmount < 0,
            clientId: p.clientId,
          })),
        },
        outstanding: {
          summary: `${formatPrice(outstanding)} on ${count(due.length, "bill")}`,
          rows: due.map((i) => ({
            id: i.id,
            title: i.clientNameSnapshot || "Member",
            sub: `${i.invoiceNumber}${i.dueDate ? ` · next payment ${formatDateISO(i.dueDate)}` : ""}`,
            right: formatPrice(i.balanceDue),
            clientId: i.clientId,
          })),
        },
        "new-clients": {
          summary: `${count(joined.length, "member")} joined ${statLabel}`,
          rows: joined.map((c) => ({
            id: c.id,
            title: c.fullName,
            sub: `${c.clientCode ? `ID ${c.clientCode} · ` : ""}joined ${formatDateISO(joinedOnOf(c))}`,
            clientId: c.id,
          })),
        },
        expired: {
          summary: `${count(expiredRows.length, "member")} with no running plan · latest first`,
          rows: expiredRows
            .sort((a, b) => b.endDate.localeCompare(a.endDate))
            .map((r) =>
              memberRow(
                r,
                `${r.code ? `ID ${r.code} · ` : ""}${r.plan} ended ${formatDateISO(r.endDate)}`,
              ),
            ),
        },
        renewals: {
          summary: `${count(renewalRows.length, "plan")} ending in the next 7 days`,
          rows: renewalRows
            .sort((a, b) => a.endDate.localeCompare(b.endDate))
            .map((r) =>
              memberRow(
                r,
                `${r.code ? `ID ${r.code} · ` : ""}${r.plan}`,
                `Ends ${formatDateISO(r.endDate)}`,
              ),
            ),
        },
        "follow-ups": {
          summary: `${count(calls.length, "call")} due today or overdue`,
          rows: calls.map((f) => ({
            id: f.id,
            title: f.clientNameSnapshot || "Lead",
            sub: `${formatDateISO(f.followUpDate)}${f.followUpTime ? ` ${formatTime(f.followUpTime)}` : ""}${f.reason ? ` · ${f.reason}` : ""}`,
            ...(f.clientId ? { clientId: f.clientId } : {}),
          })),
        },
        "pt-today": {
          summary: `${count(pt.length, "PT session")} today`,
          rows: pt.map((b) => ({
            id: b.id,
            title: b.clientNameSnapshot || "Member",
            sub: `${formatTime(b.startTime)} · with ${b.trainerNameSnapshot || "trainer"}`,
            ...(b.clientId ? { clientId: b.clientId } : {}),
          })),
        },
        "group-booked": {
          summary: count(enrolled.length, "class booking"),
          rows: enrolled.map((e) => {
            const g = classById.get(e.groupClassId);
            return {
              id: e.id,
              title: e.clientNameSnapshot || "Member",
              sub: g ? `${g.name} · ${formatDateISO(g.date)} ${formatTime(g.startTime)}` : "Class",
              clientId: e.clientId,
            };
          }),
        },
        "today-schedule": {
          summary: `${count(todaySchedule.length, "booking")} and classes today`,
          rows: todaySchedule.map((x) => ({
            id: x.id,
            title: x.title,
            sub: x.detail,
            right: formatTime(x.time),
          })),
        },
        birthdays: {
          summary: bdays.length
            ? `${count(bdays.length, "birthday")} today: send wishes`
            : "No birthdays today",
          rows: bdays.map((c) => {
            const age = Number(today.slice(0, 4)) - Number(c.dateOfBirth!.slice(0, 4));
            return {
              id: c.id,
              title: c.fullName,
              sub: `${c.clientCode ? `ID ${c.clientCode} · ` : ""}${c.phone}`,
              ...(age > 0 && age < 120 ? { right: `turns ${age}` } : {}),
              clientId: c.id,
            };
          }),
        },
        plans: {
          summary: `${count(plansOn.length, "plan")} given and running`,
          rows: plansOn.map((x) => ({
            id: x.id,
            title: clientById.get(x.clientId)?.fullName ?? "Member",
            sub: `${x.kind} · ${x.name}`,
            clientId: x.clientId,
          })),
        },
      };
    }
  }, [
    payments.data,
    manualIncome.data,
    clients.data,
    queued.data,
    recentPlans.data,
    inquiries.data,
    workouts.data,
    diets.data,
    bookings.data,
    classes.data,
    enrollments.data,
    expenses.data,
    expenseActivities.data,
    invoices.data,
    openInvoices.data,
    monthInvoices.data,
    allTime,
    attendance.data,
    followUps.data,
    automationActivities.data,
    finance,
    period.from,
    period.to,
    period.label,
    period.isToday,
    rangeVisits,
  ]);

  return { ...result, allTime, loading, error };
}
