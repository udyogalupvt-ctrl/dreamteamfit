import { useMemo } from "react";
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
import { effectiveMembershipStatus, formatNumber, formatPrice, todayISO } from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribeWorkoutAssignments } from "@/services/workout-assignments.service";
import { subscribeDietAssignments } from "@/services/diet-assignments.service";
import { subscribeBookings } from "@/services/bookings.service";
import { subscribeGroupClasses } from "@/services/group-classes.service";
import { subscribeClassEnrollments } from "@/services/class-enrollments.service";
import { subscribeExpenseActivities, subscribeExpenses } from "@/services/expenses.service";
import { subscribeInvoices } from "@/services/invoices.service";
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
import { subscribeAttendance } from "@/services/attendance.service";
import { subscribeFollowUps } from "@/services/followups.service";
import { subscribeAutomationActivities } from "@/services/notifications.service";
import { attendanceSummary } from "@/lib/attendance-utils";
import {
  buildFinanceSummary,
  subscribeManualIncome,
  subscribePayments,
} from "@/services/finance.service";
import type { ManualIncome, Payment } from "@/types/models";

/** Derives dashboard numbers from live Firestore data only — nothing is invented. */
export function useDashboardMetrics() {
  // Staff without the finance feature never load expenses (Firestore rules would refuse).
  const finance = useAccess().can("finance");
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const workouts = useLive<WorkoutAssignment[]>(subscribeWorkoutAssignments, [], []);
  const diets = useLive<DietAssignment[]>(subscribeDietAssignments, [], []);
  const bookings = useLive<Booking[]>(subscribeBookings, [], []);
  const classes = useLive<GroupClass[]>(subscribeGroupClasses, [], []);
  const enrollments = useLive<ClassEnrollment[]>(subscribeClassEnrollments, [], []);
  const expenses = useLive<Expense[]>(finance ? subscribeExpenses : null, [], [finance]);
  const expenseActivities = useLive<ExpenseActivity[]>(
    finance ? subscribeExpenseActivities : null,
    [],
    [finance],
  );
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);
  const attendance = useLive<AttendanceEvent[]>(subscribeAttendance, [], []);
  const followUps = useLive<FollowUp[]>(subscribeFollowUps, [], []);
  const automationActivities = useLive<AutomationActivity[]>(subscribeAutomationActivities, [], []);
  const payments = useLive<Payment[]>(subscribePayments, [], []);
  const manualIncome = useLive<ManualIncome[]>(
    finance ? subscribeManualIncome : null,
    [],
    [finance],
  );

  const loading =
    payments.loading ||
    clients.loading ||
    memberships.loading ||
    inquiries.loading ||
    workouts.loading ||
    diets.loading ||
    bookings.loading ||
    classes.loading ||
    enrollments.loading ||
    expenses.loading ||
    expenseActivities.loading ||
    invoices.loading ||
    attendance.loading ||
    followUps.loading ||
    automationActivities.loading;
  const error =
    payments.error ??
    manualIncome.error ??
    clients.error ??
    memberships.error ??
    inquiries.error ??
    workouts.error ??
    diets.error ??
    bookings.error ??
    classes.error ??
    enrollments.error ??
    expenses.error ??
    expenseActivities.error ??
    invoices.error ??
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
    const allTime = buildFinanceSummary(
      payments.data,
      invoices.data,
      manualIncome.data,
      expenseRows,
    );
    const todayMoney = buildFinanceSummary(
      payments.data,
      invoices.data,
      manualIncome.data,
      expenseRows,
      today,
      today,
    );
    const monthMoney = buildFinanceSummary(
      payments.data,
      invoices.data,
      manualIncome.data,
      expenseRows,
      monthStartISO,
      today,
    );
    const totalCollected = allTime.gross;
    const todayCollected = todayMoney.gross;
    const monthCollected = monthMoney.gross;
    const outstanding = invoices.data
      .filter((item) => item.paymentStatus !== "refunded")
      .reduce((sum, item) => sum + item.balanceDue, 0);
    const attendanceToday = attendance.data.filter((item) => item.attendanceDate === today);
    const attendanceTotals = attendanceSummary(attendanceToday);

    const byClient = new Map<string, Membership[]>();
    memberships.data.forEach((m) => {
      const list = byClient.get(m.clientId) ?? [];
      list.push(m);
      byClient.set(m.clientId, list);
    });

    let active = 0;
    let expired = 0;
    let renewals = 0;
    let expiringToday = 0;
    let expiringIn7Days = 0;
    byClient.forEach((list) => {
      const statuses = list.map((m) => ({ m, s: effectiveMembershipStatus(m) }));
      const current = statuses.find((x) => x.s === "active");
      if (current) {
        active += 1;
        if (current.m.endDate <= in7) renewals += 1;
        if (current.m.endDate === today) expiringToday += 1;
        if (current.m.endDate === in7) expiringIn7Days += 1;
      } else if (
        !statuses.some((x) => x.s === "pending") &&
        statuses.some((x) => x.s === "expired")
      ) {
        expired += 1;
      }
    });

    const newClients = clients.data.filter((c) => c.createdAt >= monthStart).length;
    const withDob = clients.data.filter((c) => c.dateOfBirth);
    const birthdays = withDob.filter((c) => c.dateOfBirth!.slice(5) === today.slice(5)).length;
    const followUpsDue = followUps.data.filter(
      (item) => item.status === "pending" && item.followUpDate <= today,
    ).length;

    const visitsToday = attendanceTotals.visits;
    const primary: StatMetric[] = [
      {
        id: "today-collection",
        label: "Collected today",
        value: formatPrice(todayCollected),
        hint: "all payments received today",
        icon: BadgeIndianRupee,
        tone: "success",
      },
      {
        id: "month-collection",
        label: "This month",
        value: formatPrice(monthCollected),
        hint: `gym income ${formatPrice(monthMoney.gymIncome)}`,
        icon: BadgeIndianRupee,
        tone: "primary",
      },
      {
        id: "active",
        label: "Active members",
        value: formatNumber(active),
        hint: `${formatNumber(newClients)} joined this month`,
        icon: UserRoundCheck,
        tone: "info",
      },
      {
        id: "attendance",
        label: "Visits today",
        value: formatNumber(visitsToday),
        hint: `${attendanceTotals.present} inside now · ${attendanceTotals.blocked} blocked`,
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
        label: "Profit this month",
        value: formatPrice(monthMoney.net),
        hint: "gym income − expenses (trainer share excluded)",
        icon: BadgeIndianRupee,
        tone: monthMoney.net >= 0 ? "success" : "danger",
      },
      {
        id: "month-expenses",
        label: "Expenses this month",
        value: formatPrice(monthExpenses),
        hint: `${formatPrice(todayExpenses)} today`,
        icon: ReceiptIndianRupee,
        tone: "warning",
      },
      {
        id: "trainer-payable",
        label: "Trainer share this month",
        value: formatPrice(monthMoney.trainerPayable),
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
        value: formatPrice(totalCollected),
        hint: "all time",
        icon: BadgeIndianRupee,
        tone: "success",
      },
      {
        id: "new-clients",
        label: "New members",
        value: formatNumber(newClients),
        hint: "this month",
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
      ...memberships.data.slice(0, 8).map((m) => ({
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

    return {
      primary,
      stats,
      ratios,
      activity,
      todaySchedule,
      retention: { expiringToday, expiringIn7Days, expired, birthdays },
    };
  }, [
    payments.data,
    manualIncome.data,
    clients.data,
    memberships.data,
    inquiries.data,
    workouts.data,
    diets.data,
    bookings.data,
    classes.data,
    enrollments.data,
    expenses.data,
    expenseActivities.data,
    invoices.data,
    attendance.data,
    followUps.data,
    automationActivities.data,
    finance,
  ]);

  return { ...result, loading, error };
}
