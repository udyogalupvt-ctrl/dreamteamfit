import { daysBetween, planByClient, type PlanSummary } from "@/lib/member-plans";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import type { AttendanceEvent, Client, Invoice, Membership, PtAssignment } from "@/types/models";

export const SEGMENTS = ["active", "inactive", "expiring", "payment", "blacklist"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_META: Record<Segment, { label: string; hint: string; color: string }> = {
  active: { label: "Active", hint: "Running plan and coming", color: "bg-success" },
  inactive: { label: "Inactive", hint: "Paid, but not coming", color: "bg-warning" },
  expiring: { label: "Renewal due", hint: "Plan ends soon", color: "bg-info" },
  payment: { label: "Payment due", hint: "Balance left on a bill", color: "bg-primary" },
  blacklist: { label: "Blacklist", hint: "Plan ended, not renewed", color: "bg-destructive" },
};

/** Call outcome staff pick for each member in a list. */
export const CALL_STATUSES = [
  "not_called",
  "not_answered",
  "answered",
  "call_later",
  "not_interested",
  "shifted",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  not_called: "Not called",
  not_answered: "Not answered",
  answered: "Answered",
  call_later: "Call later",
  not_interested: "Not interested",
  shifted: "Shifted / transferred",
};

export interface SegmentMember {
  client: Client;
  segment: Segment;
  /** Changes when the situation changes (new plan end, new bill), so an old call status resets. */
  episode: string;
  /** One line for staff: why this member is in the list. */
  detail: string;
  /** Pre-typed WhatsApp text for this list. */
  message: string;
  plan: PlanSummary | undefined;
  sortKey: number;
}

export interface SegmentOptions {
  /** Inactive = no allowed thumb punch for this many days while a plan is running. */
  absentDays: number;
  /** Expiring soon = plan ends within this many days. */
  expiringDays: number;
  /** Blacklist (not renewed) = plan ended within this many days. */
  renewalWindowDays: number;
  gymName: string;
}

/** Sorts every member into the call lists. A member can be in more than one (e.g. inactive + payment due). */
export function buildSegments(
  clients: Client[],
  memberships: Membership[],
  pts: PtAssignment[],
  attendance: AttendanceEvent[],
  invoices: Invoice[],
  o: SegmentOptions,
  today = todayISO(),
): Record<Segment, SegmentMember[]> {
  const plans = planByClient(memberships, pts, today);
  const lastVisit = new Map<string, string>();
  for (const e of attendance) {
    if (e.accessDecision !== "allowed" || !e.clientId) continue;
    const prev = lastVisit.get(e.clientId);
    if (!prev || e.attendanceDate > prev) lastVisit.set(e.clientId, e.attendanceDate);
  }
  const dues = new Map<string, Invoice[]>();
  for (const i of invoices)
    if (i.balanceDue > 0 && i.paymentStatus !== "refunded")
      dues.set(i.clientId, [...(dues.get(i.clientId) ?? []), i]);

  const out = Object.fromEntries(SEGMENTS.map((s) => [s, [] as SegmentMember[]])) as Record<
    Segment,
    SegmentMember[]
  >;
  const add = (m: Omit<SegmentMember, "plan"> & { plan?: PlanSummary | undefined }) =>
    out[m.segment].push({ ...m, plan: m.plan });

  for (const c of clients) {
    const plan = plans.get(c.id);
    const first = c.fullName.split(" ")[0] || c.fullName;
    const running = plan && (plan.status === "active" || plan.status === "upcoming");
    if (running && plan) {
      const last = lastVisit.get(c.id);
      const since = last && last >= plan.startDate ? last : plan.startDate;
      const gap = daysBetween(since, today);
      if (plan.status === "active" && gap >= o.absentDays)
        add({
          client: c,
          segment: "inactive",
          episode: since,
          detail: last
            ? `Last came ${formatDateISO(last)} · ${gap} days ago`
            : `Not come since joining (${gap} days)`,
          message: `Hi ${first}, we haven't seen you at ${o.gymName} for ${gap} days. Is everything okay? Your plan is running till ${formatDateISO(plan.endDate)}. See you at the gym!`,
          plan,
          sortKey: -gap,
        });
      else
        add({
          client: c,
          segment: "active",
          episode: "",
          detail: last
            ? `Last came ${formatDateISO(last)}`
            : `${plan.name} · ends ${formatDateISO(plan.endDate)}`,
          message: "",
          plan,
          sortKey: plan.daysLeft,
        });
      // Already renewed: nobody needs to call them about it.
      if (plan.daysLeft >= 0 && plan.daysLeft <= o.expiringDays && !plan.renewedUntil)
        add({
          client: c,
          segment: "expiring",
          episode: plan.endDate,
          detail: `${plan.name} ends ${formatDateISO(plan.endDate)} · ${plan.daysLeft === 0 ? "today" : `in ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"}`}`,
          message: `Hi ${first}, your ${o.gymName} membership ends on ${formatDateISO(plan.endDate)}. Renew at the front desk to keep training without a break.`,
          plan,
          sortKey: plan.daysLeft,
        });
    } else if (plan && plan.status === "expired" && -plan.daysLeft <= o.renewalWindowDays) {
      add({
        client: c,
        segment: "blacklist",
        episode: plan.endDate,
        detail: `${plan.name} ended ${formatDateISO(plan.endDate)} · ${-plan.daysLeft} days ago`,
        message: `Hi ${first}, your ${o.gymName} membership ended on ${formatDateISO(plan.endDate)}. Come back and renew, we'd love to have you training again!`,
        plan,
        sortKey: -plan.daysLeft,
      });
    }
    const bills = dues.get(c.id);
    if (bills?.length) {
      const total = bills.reduce((n, b) => n + b.balanceDue, 0);
      const next =
        bills
          .map((b) => b.dueDate)
          .filter(Boolean)
          .sort()[0] ?? "";
      add({
        client: c,
        segment: "payment",
        episode: bills
          .map((b) => `${b.id}:${b.balanceDue}`)
          .sort()
          .join(","),
        detail: `${formatPrice(total)} due${next ? ` · ${next < today ? "was due" : "due"} ${formatDateISO(next)}` : ""}`,
        message: `Hi ${first}, a balance of ${formatPrice(total)} is pending at ${o.gymName}. Please pay at the front desk on your next visit. Thank you!`,
        plan,
        sortKey: next ? daysBetween(today, next) : 0,
      });
    }
  }
  for (const s of SEGMENTS) out[s].sort((a, b) => a.sortKey - b.sortKey);
  return out;
}

/** Stable id for a member's call status in one list situation. */
export const callKey = (m: Pick<SegmentMember, "segment" | "episode" | "client">) =>
  `${m.segment}__${m.client.id}__${m.episode}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 700);
