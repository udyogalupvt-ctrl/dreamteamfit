import { useMemo } from "react";
import { addDays, format, formatDistanceToNow, startOfMonth } from "date-fns";
import {
  BadgeIndianRupee,
  Cake,
  CalendarCheck,
  CreditCard,
  Dumbbell,
  MessageSquareHeart,
  RefreshCcw,
  Salad,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import { useLive } from "@/hooks/use-live-query";
import { effectiveMembershipStatus, formatNumber, todayISO } from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribeWorkoutAssignments } from "@/services/workout-assignments.service";
import { subscribeDietAssignments } from "@/services/diet-assignments.service";
import type { ActivityItem, StatMetric } from "@/types";
import type { Client, DietAssignment, Inquiry, Membership, WorkoutAssignment } from "@/types/models";

/** Derives dashboard numbers from live Firestore data only — nothing is invented. */
export function useDashboardMetrics() {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const memberships = useLive<Membership[]>(subscribeMemberships, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const workouts = useLive<WorkoutAssignment[]>(subscribeWorkoutAssignments, [], []);
  const diets = useLive<DietAssignment[]>(subscribeDietAssignments, [], []);

  const loading = clients.loading || memberships.loading || inquiries.loading || workouts.loading || diets.loading;
  const error = clients.error ?? memberships.error ?? inquiries.error ?? workouts.error ?? diets.error;

  const result = useMemo(() => {
    const today = todayISO();
    const in7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
    const monthStart = startOfMonth(new Date());

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
      { id: "collection", label: "Total Collection", value: "—", hint: "Not available yet", icon: BadgeIndianRupee, tone: "success" },
      { id: "active", label: "Active Members", value: formatNumber(active), hint: "with a running membership", icon: UserRoundCheck, tone: "info" },
      { id: "expired", label: "Expired Members", value: formatNumber(expired), hint: "no active plan", icon: UserRoundX, tone: "danger" },
      { id: "attendance", label: "Today's Attendance", value: "—", hint: "No attendance data yet", icon: CalendarCheck, tone: "violet" },
      { id: "follow-ups", label: "Follow-ups", value: formatNumber(followUpsDue), hint: "inquiries due today", icon: MessageSquareHeart, tone: "warning" },
      { id: "renewals", label: "Upcoming Renewals", value: formatNumber(renewals), hint: "ending in 7 days", icon: RefreshCcw, tone: "info" },
      { id: "workouts", label: "Workout Plans Assigned", value: formatNumber(workouts.data.filter((item) => item.status === "active").length), hint: "currently active", icon: Dumbbell, tone: "primary" },
      { id: "diets", label: "Diet Plans Assigned", value: formatNumber(diets.data.filter((item) => item.status === "active").length), hint: "currently active", icon: Salad, tone: "success" },
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
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6)
      .map((a) => ({ ...a, time: formatDistanceToNow(a.at, { addSuffix: true }) }));

    return { stats, ratios, activity };
  }, [clients.data, memberships.data, inquiries.data, workouts.data, diets.data]);

  return { ...result, loading, error };
}
