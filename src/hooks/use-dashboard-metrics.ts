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
import type { Booking, ClassEnrollment, Client, DietAssignment, Expense, ExpenseActivity, GroupClass, Inquiry, Invoice, Membership, WorkoutAssignment } from "@/types/models";

/** Derives dashboard numbers from live Firestore data only — nothing is invented. */
export function useDashboardMetrics() {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const workouts = useLive<WorkoutAssignment[]>(subscribeWorkoutAssignments, [], []);
  const diets = useLive<DietAssignment[]>(subscribeDietAssignments, [], []);
  const bookings = useLive<Booking[]>(subscribeBookings, [], []);
  const classes = useLive<GroupClass[]>(subscribeGroupClasses, [], []);
  const enrollments = useLive<ClassEnrollment[]>(subscribeClassEnrollments, [], []);
  const expenses = useLive<Expense[]>(subscribeExpenses, [], []);
  const expenseActivities = useLive<ExpenseActivity[]>(subscribeExpenseActivities, [], []);
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);

  const loading = clients.loading || memberships.loading || inquiries.loading || workouts.loading || diets.loading || bookings.loading || classes.loading || enrollments.loading || expenses.loading || expenseActivities.loading || invoices.loading;
  const error = clients.error ?? memberships.error ?? inquiries.error ?? workouts.error ?? diets.error ?? bookings.error ?? classes.error ?? enrollments.error ?? expenses.error ?? expenseActivities.error ?? invoices.error;

  const result = useMemo(() => {
    const today = todayISO();
    const in7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
    const monthStart = startOfMonth(new Date());
    const monthStartISO = format(monthStart, "yyyy-MM-dd");
    const todayExpenses = expenses.data.filter((item) => item.date === today).reduce((sum, item) => sum + item.amount, 0);
    const monthExpenses = expenses.data.filter((item) => item.date >= monthStartISO && item.date <= today).reduce((sum, item) => sum + item.amount, 0);
    const totalCollected = invoices.data.reduce((sum,item)=>sum+item.amountPaid,0);
    const todayCollected = invoices.data.filter(item=>item.invoiceDate===today).reduce((sum,item)=>sum+item.amountPaid,0);
    const monthCollected = invoices.data.filter(item=>item.invoiceDate>=monthStartISO&&item.invoiceDate<=today).reduce((sum,item)=>sum+item.amountPaid,0);
    const outstanding = invoices.data.filter(item=>item.paymentStatus!=="refunded").reduce((sum,item)=>sum+item.balanceDue,0);

    const byClient = new Map<string, Membership[]>();
    memberships.data.forEach((m) => {
      const list = byClient.get(m.clientId) ?? [];
      list.push(m);
      byClient.set(m.clientId, list);
    });

    let active = 0;
    let expired = 0;
    let renewals = 0;
    byClient.forEach((list) => {
      const statuses = list.map((m) => ({ m, s: effectiveMembershipStatus(m) }));
      const current = statuses.find((x) => x.s === "active");
      if (current) {
        active += 1;
        if (current.m.endDate <= in7) renewals += 1;
      } else if (!statuses.some((x) => x.s === "pending") && statuses.some((x) => x.s === "expired")) {
        expired += 1;
      }
    });

    const newClients = clients.data.filter((c) => c.createdAt >= monthStart).length;
    const withDob = clients.data.filter((c) => c.dateOfBirth);
    const birthdays = withDob.filter((c) => c.dateOfBirth!.slice(5) === today.slice(5)).length;
    const followUpsDue = inquiries.data.filter(
      (i) =>
        i.nextFollowUpDate &&
        i.nextFollowUpDate <= today &&
        i.status !== "converted" &&
        i.status !== "lost",
    ).length;

    const stats: StatMetric[] = [
      { id: "new-clients", label: "New Clients", value: formatNumber(newClients), hint: "this month", icon: UserPlus, tone: "primary" },
      { id: "today-collection", label: "Today's Collection", value: formatPrice(todayCollected), hint: "recorded payments today", icon: BadgeIndianRupee, tone: "success" },
      { id: "month-collection", label: "This Month's Collection", value: formatPrice(monthCollected), hint: "recorded payments this month", icon: BadgeIndianRupee, tone: "success" },
      { id: "collection", label: "Total Revenue", value: formatPrice(totalCollected), hint: "all recorded payments", icon: BadgeIndianRupee, tone: "success" },
      { id: "outstanding", label: "Outstanding Amount", value: formatPrice(outstanding), hint: "unpaid invoice balance", icon: CreditCard, tone: "warning" },
      { id: "active", label: "Active Members", value: formatNumber(active), hint: "with a running membership", icon: UserRoundCheck, tone: "info" },
      { id: "expired", label: "Expired Members", value: formatNumber(expired), hint: "no active plan", icon: UserRoundX, tone: "danger" },
      { id: "attendance", label: "Today's Attendance", value: "—", hint: "No attendance data yet", icon: CalendarCheck, tone: "violet" },
      { id: "follow-ups", label: "Follow-ups", value: formatNumber(followUpsDue), hint: "inquiries due today", icon: MessageSquareHeart, tone: "warning" },
      { id: "renewals", label: "Upcoming Renewals", value: formatNumber(renewals), hint: "ending in 7 days", icon: RefreshCcw, tone: "info" },
      { id: "workouts", label: "Workout Plans Assigned", value: formatNumber(workouts.data.filter((item) => item.status === "active").length), hint: "currently active", icon: Dumbbell, tone: "primary" },
      { id: "diets", label: "Diet Plans Assigned", value: formatNumber(diets.data.filter((item) => item.status === "active").length), hint: "currently active", icon: Salad, tone: "success" },
      { id: "pt-booked", label: "Booked PT Sessions", value: formatNumber(bookings.data.filter((item) => item.bookingType === "pt" && item.status === "scheduled" && item.date >= today).length), hint: "scheduled from today", icon: Dumbbell, tone: "primary" },
      { id: "group-booked", label: "Booked Group Classes", value: formatNumber(enrollments.data.filter((item) => item.status === "enrolled").length), hint: "active enrollments", icon: UsersRound, tone: "info" },
      { id: "today-schedule", label: "Today's Schedule", value: formatNumber(bookings.data.filter((item) => item.date === today && item.status === "scheduled").length + classes.data.filter((item) => item.date === today && item.status === "scheduled").length), hint: "bookings and classes", icon: CalendarClock, tone: "warning" },
      { id: "today-expenses", label: "Today's Expenses", value: formatPrice(todayExpenses), hint: "from expense records", icon: ReceiptIndianRupee, tone: "danger" },
      { id: "month-expenses", label: "Monthly Expenses", value: formatPrice(monthExpenses), hint: "current month", icon: ReceiptIndianRupee, tone: "warning" },
      { id: "profit-loss", label: "Profit/Loss", value: formatPrice(totalCollected-expenses.data.reduce((sum,item)=>sum+item.amount,0)), hint: "collected revenue minus expenses", icon: BadgeIndianRupee, tone: totalCollected-expenses.data.reduce((sum,item)=>sum+item.amount,0)>=0?"success":"danger" },
      {
        id: "birthdays",
        label: "Birthdays Today",
        value: withDob.length ? formatNumber(birthdays) : "—",
        hint: withDob.length ? "clients" : "add birth dates to track",
        icon: Cake,
        tone: "violet",
      },
    ];

    const totalInquiries = inquiries.data.length;
    const converted = inquiries.data.filter((i) => i.convertedToClient).length;
    const ratios = [
      { label: "Inquiry conversion", pct: totalInquiries ? Math.round((converted / totalInquiries) * 100) : null, tone: "bg-success" },
      { label: "Active member ratio", pct: clients.data.length ? Math.round((active / clients.data.length) * 100) : null, tone: "bg-info" },
      { label: "Renewals due (of active)", pct: active ? Math.round((renewals / active) * 100) : null, tone: "bg-warning" },
    ];

    const clientName = new Map(clients.data.map((c) => [c.id, c.fullName]));
    const activity: (ActivityItem & { at: Date })[] = [
      ...clients.data.slice(0, 8).map((c) => ({
        id: `c-${c.id}`,
        title: `${c.fullName} joined as a client`,
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
        title: item.action === "created" ? "Expense added" : item.action === "updated" ? "Expense updated" : "Expense removed",
        description: `${item.expenseTitleSnapshot} · ${item.createdBy}`,
        at: item.createdAt,
        tone: item.action === "deleted" ? "danger" as const : "warning" as const,
        icon: ReceiptIndianRupee,
      })),
      ...invoices.data.slice(0,8).map(item=>({id:`invoice-${item.id}`,title:`${item.invoiceNumber} generated`,description:`${item.clientNameSnapshot} · ${formatPrice(item.amountPaid)} collected`,at:item.createdAt,tone:"success" as const,icon:BadgeIndianRupee})),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6)
      .map((a) => ({ ...a, time: formatDistanceToNow(a.at, { addSuffix: true }) }));

    const todaySchedule = [
      ...bookings.data.filter((item) => item.date === today && item.status === "scheduled").map((item) => ({ id: `booking-${item.id}`, time: item.startTime, title: item.clientNameSnapshot || "Group class booking", detail: item.trainerNameSnapshot ? `Trainer ${item.trainerNameSnapshot}` : item.bookingType.replace("_", " ") })),
      ...classes.data.filter((item) => item.date === today && item.status === "scheduled").map((item) => ({ id: `class-${item.id}`, time: item.startTime, title: item.name, detail: `${item.bookedCount}/${item.capacity} booked · Trainer ${item.trainerNameSnapshot}` })),
    ].sort((a, b) => a.time.localeCompare(b.time));

    return { stats, ratios, activity, todaySchedule };
  }, [clients.data, memberships.data, inquiries.data, workouts.data, diets.data, bookings.data, classes.data, enrollments.data, expenses.data, expenseActivities.data, invoices.data]);

  return { ...result, loading, error };
}
