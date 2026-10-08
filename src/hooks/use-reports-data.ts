import { useEffect, useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import { useLive } from "@/hooks/use-live-query";
import {
  ASSIGNMENT_STATUS_META,
  BOOKING_STATUS_META,
  effectiveMembershipStatus,
  INQUIRY_STATUS_META,
  INVOICE_STATUS_META,
  joinedOnOf,
  MEMBERSHIP_STATUS_META,
  SOURCE_LABELS,
  todayISO,
} from "@/lib/format";
import {
  calculateProfitLoss,
  getReportDateRange,
  isDateInRange,
  type ReportDateRange,
  type ReportPeriod,
} from "@/lib/reporting";
import type { ReportCell, ReportSheet } from "@/lib/report-export";
import { ACCESS_REASON_LABELS, EVENT_LABELS } from "@/lib/attendance-utils";
import { subscribeBookings } from "@/services/bookings.service";
import { subscribeClassEnrollments } from "@/services/class-enrollments.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribeDietAssignments } from "@/services/diet-assignments.service";
import { subscribeExpenses } from "@/services/expenses.service";
import { useAccess } from "@/hooks/use-access";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { buildFinanceSummary, subscribePaymentsSince } from "@/services/finance.service";
import { subscribeWorkoutAssignments } from "@/services/workout-assignments.service";
import type {
  Payment,
  AttendanceEvent,
  Booking,
  ClassEnrollment,
  Client,
  DietAssignment,
  Expense,
  FollowUp,
  Inquiry,
  Invoice,
  Notification,
  Membership,
  WorkoutAssignment,
} from "@/types/models";
import { attendanceCounts, subscribeAttendanceRange } from "@/services/attendance.service";
import { subscribeFollowUps } from "@/services/followups.service";
import { subscribeNotifications } from "@/services/notifications.service";
import { EXPENSE_CATEGORIES, INQUIRY_STATUSES } from "@/types/models";

const dateOf = (value: Date) => format(value, "yyyy-MM-dd");
/** "upi" → "Upi", "bank_transfer" → "Bank transfer" (for the sheets). */
const cap = (v: string | null | undefined) => {
  const t = String(v ?? "").replace(/_/g, " ");
  return t ? t[0]!.toUpperCase() + t.slice(1) : "";
};
export function useReportsData(period: ReportPeriod, custom?: ReportDateRange) {
  const finance = useAccess().can("finance");
  const clients = useLive<Client[]>(subscribeClients, [], []),
    memberships = useLive<Membership[]>(subscribeMemberships, [], []),
    inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []),
    bookings = useLive<Booking[]>(subscribeBookings, [], []),
    enrollments = useLive<ClassEnrollment[]>(subscribeClassEnrollments, [], []),
    workouts = useLive<WorkoutAssignment[]>(subscribeWorkoutAssignments, [], []),
    diets = useLive<DietAssignment[]>(subscribeDietAssignments, [], []),
    expenses = useLive<Expense[]>(finance ? subscribeExpenses : null, [], [finance]),
    invoices = useLive<Invoice[]>(subscribeInvoices, [], []),
    followups = useLive<FollowUp[]>(subscribeFollowUps, [], []),
    notifications = useLive<Notification[]>(subscribeNotifications, [], []);
  const range = getReportDateRange(period, custom);
  // Money collected = payments by the day they came in (same as the Dashboard, Billing, Day Book):
  // a balance paid later counts on the day it was paid, not on the bill's date.
  const payments = useLive<Payment[]>(
    (ok, fail) => subscribePaymentsSince(range.start, ok, fail),
    [],
    [range.start],
  );
  // Visits of the chosen period only. Up to a month they are loaded; a longer period (a year is
  // ~90,000 visits) uses counts, which cost about one read per 1,000 visits.
  const days = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
  const small = days <= 31;
  const attendance = useLive<AttendanceEvent[]>(
    small ? (ok, fail) => subscribeAttendanceRange(range.start, range.end, ok, fail) : null,
    [],
    [small, range.start, range.end],
  );
  const [bigVisits, setBigVisits] = useState<{
    visits: number;
    unique: number;
    blocked: number | null;
  } | null>(null);
  useEffect(() => {
    if (small) return;
    let live = true;
    void attendanceCounts(range.start, range.end)
      .then((c) => live && setBigVisits(c))
      .catch(() => live && setBigVisits(null));
    return () => {
      live = false;
    };
  }, [small, range.start, range.end]);
  const result = useMemo(() => {
    const inRange = (v: string) => isDateInRange(v, range);
    const expenseRows = expenses.data.filter((e) => inRange(e.date));
    const expenseTotal = expenseRows.reduce((n, e) => n + e.amount, 0);
    // Built-in categories plus any custom ones used in the period.
    const expenseBreakdown = [
      ...new Set([...EXPENSE_CATEGORIES, ...expenseRows.map((e) => e.category)]),
    ].map((category) => ({
      category,
      amount: expenseRows.filter((e) => e.category === category).reduce((n, e) => n + e.amount, 0),
    }));
    const currentMemberships = memberships.data.map((m) => ({
      ...m,
      effective: effectiveMembershipStatus(m),
    }));
    const byClient = new Map<string, typeof currentMemberships>();
    currentMemberships.forEach((m) =>
      byClient.set(m.clientId, [...(byClient.get(m.clientId) ?? []), m]),
    );
    let active = 0,
      expired = 0,
      upcoming = 0;
    const today = todayISO(),
      in7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
    byClient.forEach((items) => {
      const activeItem = items.find((m) => m.effective === "active");
      if (activeItem) {
        active += 1;
        if (activeItem.endDate >= today && activeItem.endDate <= in7) upcoming += 1;
      } else if (items.some((m) => m.effective === "expired")) expired += 1;
    });
    const rangedInquiries = inquiries.data.filter((i) => inRange(dateOf(i.createdAt)));
    // Plans moved over from the old software were sold there: not counted as new here.
    const movedInRange = memberships.data.filter(
      (m) => m.paidInOldSoftware && inRange(dateOf(m.createdAt)),
    ).length;
    const soldInRange =
      memberships.data.filter((m) => inRange(dateOf(m.createdAt))).length - movedInRange;
    const inquiryCounts = Object.fromEntries(
      INQUIRY_STATUSES.map((status) => [
        status,
        rangedInquiries.filter((i) => i.status === status).length,
      ]),
    );
    const converted = inquiryCounts["converted"] ?? 0;
    const conversionRate = rangedInquiries.length
      ? Math.round((converted / rangedInquiries.length) * 100)
      : null;
    const rangedBookings = bookings.data.filter((b) => inRange(b.date)),
      rangedEnrollments = enrollments.data.filter((e) => inRange(dateOf(e.enrolledAt))),
      rangedWorkouts = workouts.data.filter((w) => inRange(w.assignedDate)),
      rangedDiets = diets.data.filter((d) => inRange(d.assignedDate));
    const rangedInvoices = invoices.data.filter((i) => inRange(i.invoiceDate));
    const rangedAttendance = attendance.data.filter((a) => inRange(a.attendanceDate));
    const attendanceVisits = small
        ? rangedAttendance.filter(
            (a) => a.eventType === "check_in" && a.accessDecision === "allowed",
          ).length
        : (bigVisits?.visits ?? 0),
      attendanceUnique = small
        ? new Set(
            rangedAttendance
              .filter((a) => a.accessDecision === "allowed")
              .map((a) => a.clientId)
              .filter(Boolean),
          ).size
        : (bigVisits?.unique ?? 0),
      attendanceBlocked = small
        ? rangedAttendance.filter((a) => a.accessDecision === "blocked").length
        : (bigVisits?.blocked ?? null);
    const money = buildFinanceSummary(payments.data, invoices.data, [], [], range.start, range.end);
    const grossSales = rangedInvoices.reduce((n, i) => n + i.total, 0),
      collected = money.gross,
      outstanding = rangedInvoices
        .filter((i) => i.paymentStatus !== "refunded")
        .reduce((n, i) => n + i.balanceDue, 0),
      refunded = money.refunded;
    // ---- Sheets for Excel / CSV (same period and same counting as the cards on the page).
    const clientById = new Map(clients.data.map((c) => [c.id, c]));
    const codeOf = (id: string | null | undefined) => (id && clientById.get(id)?.clientCode) || "";
    const phoneOf = (id: string | null | undefined) => (id && clientById.get(id)?.phone) || "";
    const nameOf = (id: string | null | undefined) => (id && clientById.get(id)?.fullName) || "";
    const statusOfClient = (id: string) => {
      const items = byClient.get(id) ?? [];
      const live = items.find((m) => m.effective === "active");
      const last = [...items]
        .filter((m) => m.status !== "cancelled")
        .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
      return {
        live,
        last,
        label: live
          ? "Active"
          : items.some((m) => m.effective === "pending" || m.effective === "biometric_pending")
            ? "Starting soon"
            : items.some((m) => m.effective === "expired")
              ? "Expired"
              : "No plan",
      };
    };
    const daysBetween = (from: string, to: string) =>
      Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    const byDate = <T>(rows: T[], key: (r: T) => string) =>
      [...rows].sort((a, b) => key(a).localeCompare(key(b)));

    const sheets: ReportSheet[] = [
      {
        id: "bills",
        title: "Bills",
        hint: "Bills dated in the period, with what was paid and what is left",
        columns: [
          { label: "Bill no." },
          { label: "Date", type: "date" },
          { label: "Member" },
          { label: "Member ID" },
          { label: "Phone" },
          { label: "Items" },
          { label: "Total", type: "money" },
          { label: "Discount", type: "money" },
          { label: "Paid", type: "money" },
          { label: "Balance", type: "money" },
          { label: "Status" },
          { label: "Paid by" },
          { label: "Balance due by", type: "date" },
          { label: "Counsellor" },
          { label: "Made by" },
        ],
        rows: byDate(rangedInvoices, (i) => `${i.invoiceDate} ${i.invoiceNumber}`).map((i) => [
          i.invoiceNumber,
          i.invoiceDate,
          i.clientNameSnapshot,
          codeOf(i.clientId),
          i.clientPhoneSnapshot || phoneOf(i.clientId),
          i.items.map((it) => it.name).join(", "),
          i.total,
          i.discount,
          i.amountPaid,
          i.balanceDue,
          INVOICE_STATUS_META[i.paymentStatus]?.label ?? i.paymentStatus,
          i.amountPaid > 0 ? cap(i.paymentMethod) : "",
          i.balanceDue > 0 ? i.dueDate : "",
          i.counsellorName,
          i.createdBy,
        ]),
      },
      ...(finance
        ? [
            {
              id: "expenses",
              title: "Expenses",
              hint: "Expenses dated in the period",
              columns: [
                { label: "Date", type: "date" },
                { label: "Title" },
                { label: "Category" },
                { label: "Amount", type: "money" },
                { label: "Paid by" },
                { label: "Paid from" },
                { label: "Added by" },
                { label: "Notes" },
              ],
              rows: byDate(expenseRows, (e) => e.date).map((e) => [
                e.date,
                e.title,
                e.category,
                e.amount,
                cap(e.paymentMethod),
                e.paidBy,
                e.createdBy,
                [e.description, e.notes].filter(Boolean).join(" · "),
              ]),
            } satisfies ReportSheet,
          ]
        : []),
      {
        id: "new-members",
        title: "New members",
        hint: "Members who joined in the period (by their joining date)",
        columns: [
          { label: "Member ID" },
          { label: "Name" },
          { label: "Phone" },
          { label: "Gender" },
          { label: "Joined on", type: "date" },
          { label: "Added to the app", type: "date" },
          { label: "Came from" },
          { label: "Old software ID" },
          { label: "Plan now" },
          { label: "Plan ends", type: "date" },
          { label: "Status" },
        ],
        rows: byDate(
          clients.data.filter((c) => inRange(joinedOnOf(c))),
          (c) => joinedOnOf(c),
        ).map((c) => {
          const st = statusOfClient(c.id);
          return [
            c.clientCode,
            c.fullName,
            c.phone,
            c.gender === "unspecified" ? "" : cap(c.gender),
            joinedOnOf(c),
            dateOf(c.createdAt),
            SOURCE_LABELS[c.source] ?? c.source,
            c.oldMemberId,
            (st.live ?? st.last)?.packageNameSnapshot ?? "",
            (st.live ?? st.last)?.endDate ?? "",
            st.label,
          ];
        }),
      },
      {
        id: "plans",
        title: "Plans sold",
        hint: "Gym plans added in the period (new and renewals)",
        columns: [
          { label: "Added on", type: "date" },
          { label: "Member" },
          { label: "Member ID" },
          { label: "Phone" },
          { label: "Package" },
          { label: "Starts", type: "date" },
          { label: "Ends", type: "date" },
          { label: "Days", type: "number" },
          { label: "Price", type: "money" },
          { label: "Status" },
          { label: "Counsellor" },
        ],
        rows: byDate(
          currentMemberships.filter((m) => !m.paidInOldSoftware && inRange(dateOf(m.createdAt))),
          (m) => dateOf(m.createdAt),
        ).map((m) => [
          dateOf(m.createdAt),
          nameOf(m.clientId),
          codeOf(m.clientId),
          phoneOf(m.clientId),
          m.packageNameSnapshot,
          m.startDate,
          m.endDate,
          m.durationDaysSnapshot,
          m.priceSnapshot,
          MEMBERSHIP_STATUS_META[m.effective]?.label ?? m.effective,
          m.counsellorName,
        ]),
      },
      {
        id: "renewals",
        title: "Renewals due",
        hint: "Active members whose plan ends in the next 7 days (as of today)",
        columns: [
          { label: "Member" },
          { label: "Member ID" },
          { label: "Phone" },
          { label: "Package" },
          { label: "Ends on", type: "date" },
          { label: "Days left", type: "number" },
        ],
        rows: byDate(
          clients.data
            .map((c) => ({ c, live: statusOfClient(c.id).live }))
            .filter(({ live }) => live && live.endDate >= today && live.endDate <= in7),
          ({ live }) => live!.endDate,
        ).map(({ c, live }) => [
          c.fullName,
          c.clientCode,
          c.phone,
          live!.packageNameSnapshot,
          live!.endDate,
          daysBetween(today, live!.endDate),
        ]),
      },
      {
        id: "expired",
        title: "Expired members",
        hint: "Members whose plan has ended and who have not renewed (as of today)",
        columns: [
          { label: "Member" },
          { label: "Member ID" },
          { label: "Phone" },
          { label: "Last package" },
          { label: "Ended on", type: "date" },
          { label: "Days since", type: "number" },
        ],
        rows: clients.data
          .map((c) => ({ c, st: statusOfClient(c.id) }))
          .filter(({ st }) => st.label === "Expired" && st.last)
          .sort((a, b) => b.st.last!.endDate.localeCompare(a.st.last!.endDate))
          .map(({ c, st }) => [
            c.fullName,
            c.clientCode,
            c.phone,
            st.last!.packageNameSnapshot,
            st.last!.endDate,
            daysBetween(st.last!.endDate, today),
          ]),
      },
      {
        id: "members",
        title: "All members",
        hint: "Every member with their plan today",
        columns: [
          { label: "Member ID" },
          { label: "Name" },
          { label: "Phone" },
          { label: "Gender" },
          { label: "Date of birth", type: "date" },
          { label: "Joined on", type: "date" },
          { label: "Old software ID" },
          { label: "Status" },
          { label: "Plan" },
          { label: "Plan ends", type: "date" },
          { label: "Email" },
          { label: "Address" },
        ],
        rows: [...clients.data]
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
          .map((c) => {
            const st = statusOfClient(c.id);
            return [
              c.clientCode,
              c.fullName,
              c.phone,
              c.gender === "unspecified" ? "" : cap(c.gender),
              c.dateOfBirth,
              joinedOnOf(c),
              c.oldMemberId,
              st.label,
              (st.live ?? st.last)?.packageNameSnapshot ?? "",
              (st.live ?? st.last)?.endDate ?? "",
              c.email,
              c.address,
            ];
          }),
      },
      {
        id: "inquiries",
        title: "Inquiries",
        hint: "Inquiries taken in the period",
        columns: [
          { label: "Date", type: "date" },
          { label: "Name" },
          { label: "Phone" },
          { label: "Came from" },
          { label: "Goal" },
          { label: "Status" },
          { label: "Next follow-up", type: "date" },
          { label: "Expected to join", type: "date" },
          { label: "Assigned to" },
          { label: "Notes" },
        ],
        rows: byDate(rangedInquiries, (i) => dateOf(i.createdAt)).map((i) => [
          dateOf(i.createdAt),
          i.name,
          i.phone,
          SOURCE_LABELS[i.source] ?? i.source,
          i.fitnessGoal,
          INQUIRY_STATUS_META[i.status]?.label ?? i.status,
          i.nextFollowUpDate ?? "",
          i.expectedJoinDate ?? "",
          i.assignedTo,
          i.notes,
        ]),
      },
      {
        id: "bookings",
        title: "Bookings",
        hint: "Sessions booked for days in the period",
        columns: [
          { label: "Date", type: "date" },
          { label: "Time" },
          { label: "Type" },
          { label: "Member" },
          { label: "Member ID" },
          { label: "Trainer" },
          { label: "Package" },
          { label: "Status" },
        ],
        rows: byDate(rangedBookings, (b) => `${b.date} ${b.startTime}`).map((b) => [
          b.date,
          [b.startTime, b.endTime].filter(Boolean).join("–"),
          b.bookingType === "pt" ? "Personal training" : cap(b.bookingType),
          b.clientNameSnapshot,
          codeOf(b.clientId),
          b.trainerNameSnapshot || b.assignedTrainerNameSnapshot,
          b.ptPackageNameSnapshot,
          BOOKING_STATUS_META[b.status]?.label ?? b.status,
        ]),
      },
      {
        id: "workout-diet",
        title: "Workout & diet",
        hint: "Workout and diet plans given in the period",
        columns: [
          { label: "Given on", type: "date" },
          { label: "Type" },
          { label: "Member" },
          { label: "Member ID" },
          { label: "Plan" },
          { label: "Starts", type: "date" },
          { label: "Ends", type: "date" },
          { label: "Status" },
        ],
        rows: byDate(
          [
            ...rangedWorkouts.map((w) => ({ ...w, kind: "Workout" })),
            ...rangedDiets.map((d) => ({ ...d, kind: "Diet" })),
          ],
          (a) => a.assignedDate,
        ).map((a) => [
          a.assignedDate,
          a.kind,
          nameOf(a.clientId),
          codeOf(a.clientId),
          a.planNameSnapshot,
          a.startDate,
          a.endDate,
          ASSIGNMENT_STATUS_META[a.status]?.label ?? a.status,
        ]),
      },
      ...(small
        ? [
            {
              id: "visits",
              title: "Visits",
              hint: "Every thumb at the door in the period",
              columns: [
                { label: "Date", type: "date" },
                { label: "Time" },
                { label: "Member" },
                { label: "Member ID" },
                { label: "Thumb ID" },
                { label: "In / out" },
                { label: "Door" },
                { label: "Device" },
                { label: "Reason" },
                { label: "Source" },
              ],
              rows: [...rangedAttendance]
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .map((a) => [
                  a.attendanceDate,
                  format(a.timestamp, "HH:mm"),
                  a.clientNameSnapshot,
                  codeOf(a.clientId),
                  a.biometricUserId,
                  EVENT_LABELS[a.eventType] ?? a.eventType,
                  a.accessDecision === "allowed" ? "Allowed" : "Blocked",
                  a.deviceNameSnapshot,
                  ACCESS_REASON_LABELS[a.accessReason] ?? a.accessReason,
                  cap(a.source),
                ]),
            } satisfies ReportSheet,
          ]
        : []),
    ];
    const summary: ReportSheet = {
      id: "summary",
      title: "Summary",
      hint: "The numbers on this page",
      columns: [{ label: "Section" }, { label: "Measure" }, { label: "Value" }],
      rows: [
        ["Period", "From", range.start],
        ["Period", "To", range.end],
        ["Money", "Collected", collected],
        ["Money", "Gross sales", grossSales],
        ["Money", "Outstanding", outstanding],
        ["Money", "Refunded", refunded],
        ...(finance
          ? ([
              ["Money", "Expenses", expenseTotal],
              ["Money", "Profit / loss", collected - expenseTotal],
              ...expenseBreakdown
                .filter((x) => x.amount)
                .map((x): ReportCell[] => ["Expenses", x.category, x.amount]),
            ] as ReportCell[][])
          : []),
        ["Members", "Total members", clients.data.length],
        ["Members", "Active members", active],
        ["Members", "Expired members", expired],
        ["Members", "New members", clients.data.filter((c) => inRange(joinedOnOf(c))).length],
        ["Members", "New memberships", soldInRange],
        ["Members", "Plans moved from the old software", movedInRange],
        ["Members", "Renewals due in 7 days", upcoming],
        ["Inquiries", "Total", rangedInquiries.length],
        ...INQUIRY_STATUSES.map((st): ReportCell[] => [
          "Inquiries",
          INQUIRY_STATUS_META[st].label,
          inquiryCounts[st] ?? 0,
        ]),
        ["Inquiries", "Conversion rate", conversionRate === null ? "" : `${conversionRate}%`],
        ["Bookings", "Total", rangedBookings.length],
        ["Bookings", "Group class bookings", rangedEnrollments.length],
        ["Plans", "Workout plans given", rangedWorkouts.length],
        ["Plans", "Diet plans given", rangedDiets.length],
        ["Visits", "Allowed visits", attendanceVisits],
        ["Visits", "Unique members", attendanceUnique],
        ["Visits", "Blocked attempts", attendanceBlocked ?? ""],
      ],
    };
    return {
      range,
      expenseRows,
      expenseTotal,
      expenseBreakdown,
      revenue: { grossSales, collected, outstanding, refunded },
      financials: calculateProfitLoss(collected, expenseTotal),
      clients: {
        total: clients.data.length,
        active,
        expired,
        newClients: clients.data.filter((c) => inRange(joinedOnOf(c))).length,
        newMemberships: soldInRange,
        upcoming,
      },
      inquiries: { total: rangedInquiries.length, counts: inquiryCounts, conversionRate },
      bookings: {
        total: rangedBookings.length,
        pt: rangedBookings.filter((b) => b.bookingType === "pt").length,
        group: rangedEnrollments.length,
        completed: rangedBookings.filter((b) => b.status === "completed").length,
        cancelled: rangedBookings.filter((b) => b.status === "cancelled").length,
        noShow: rangedBookings.filter((b) => b.status === "no_show").length,
      },
      plans: {
        activeWorkouts: workouts.data.filter((w) => w.status === "active").length,
        activeDiets: diets.data.filter((d) => d.status === "active").length,
        workoutAssignments: rangedWorkouts.length,
        dietAssignments: rangedDiets.length,
      },
      attendance: {
        visits: attendanceVisits,
        unique: attendanceUnique,
        blocked: attendanceBlocked,
      },
      sheets: [summary, ...sheets],
    };
  }, [
    range.start,
    range.end,
    payments.data,
    finance,
    small,
    bigVisits,
    clients.data,
    memberships.data,
    inquiries.data,
    bookings.data,
    enrollments.data,
    workouts.data,
    diets.data,
    expenses.data,
    invoices.data,
    attendance.data,
    followups.data,
    notifications.data,
  ]);
  return {
    ...result,
    loading: [
      clients,
      memberships,
      inquiries,
      bookings,
      enrollments,
      workouts,
      diets,
      expenses,
      invoices,
      attendance,
      followups,
      notifications,
    ].some((x) => x.loading),
    error:
      [
        clients,
        memberships,
        inquiries,
        bookings,
        enrollments,
        workouts,
        diets,
        expenses,
        invoices,
        attendance,
        followups,
        notifications,
      ].find((x) => x.error)?.error ?? null,
  };
}
