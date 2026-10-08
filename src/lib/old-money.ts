/**
 * Money a member paid in the old gym software, counted on the day it was really paid there.
 *
 * Each old plan gets payment records (`oldSoftware: true`, no bill here) dated when the money was
 * paid: by default the plan's start day (the old software renewed and took the money that day);
 * staff split it into parts when it was paid in parts. They count in Collected, month totals,
 * income and the CFO like any payment, but never in the Day Book cash drawer, incentives or a
 * trainer payout (the trainer was settled in the old software). One old plan = one amount: a gym
 * plan and a PT plan that were one old plan ("PT + floor charges") share one payment.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const OLD_PAY_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Other"] as const;
export type OldPayMethod = (typeof OLD_PAY_METHODS)[number];

/** One payment made in the old software. `id` = its payment record, once saved. */
export interface OldPayRow {
  id?: string | undefined;
  date: string;
  amount: number;
  method: OldPayMethod;
}

/** What the old payment paid for: the gym plan's and/or the PT plan's price here. */
export interface OldSplitBasis {
  gym: { price: number } | null;
  /** `trainerShare` = the trainer's ₹ share of `price` agreed on the PT plan. */
  pt: { price: number; trainerShare: number } | null;
}

export interface OldSplit {
  trainerShareAmount: number;
  gymAmount: number;
  membershipGymAmount: number;
  ptGymAmount: number;
  otherGymAmount: number;
}

/**
 * Splits an old-software payment like a bill's payment (allocatePayment): gym plan → membership
 * income; PT plan → the trainer's share at the PT plan's own rate + the gym's PT share; one old
 * plan for both → by the two prices. The parts always add up to the amount.
 */
export function oldMoneySplit(amount: number, basis: OldSplitBasis): OldSplit {
  const a = round(amount);
  const gymPrice = Math.max(0, Number(basis.gym?.price ?? 0));
  const ptPrice = Math.max(0, Number(basis.pt?.price ?? 0));
  const share = Math.min(ptPrice, Math.max(0, Number(basis.pt?.trainerShare ?? 0)));
  if (!basis.pt) return gymOnly(a);
  if (!basis.gym || gymPrice + ptPrice <= 0) {
    if (!basis.gym) {
      const trainerShareAmount = ptPrice > 0 ? round(Math.min(a, (a * share) / ptPrice)) : 0;
      const gymAmount = round(a - trainerShareAmount);
      return {
        trainerShareAmount,
        gymAmount,
        membershipGymAmount: 0,
        ptGymAmount: gymAmount,
        otherGymAmount: 0,
      };
    }
    return gymOnly(a);
  }
  const ratio = a / (gymPrice + ptPrice);
  const trainerShareAmount = round(share * ratio);
  const ptGymAmount = round((ptPrice - share) * ratio);
  const gymAmount = round(a - trainerShareAmount);
  return {
    trainerShareAmount,
    gymAmount,
    membershipGymAmount: round(gymAmount - ptGymAmount),
    ptGymAmount,
    otherGymAmount: 0,
  };
}

const gymOnly = (a: number): OldSplit => ({
  trainerShareAmount: 0,
  gymAmount: a,
  membershipGymAmount: a,
  ptGymAmount: 0,
  otherGymAmount: 0,
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "" when the rows can be saved, else what to fix. */
export function checkOldRows(rows: OldPayRow[], today: string): string {
  if (!rows.length) return "Add at least one payment (the day and the amount paid there).";
  if (rows.length > 12) return "At most 12 part payments.";
  for (const r of rows) {
    if (!ISO.test(r.date)) return "Every payment needs the day it was paid.";
    if (r.date > today)
      return "A payment in the old software can't be after today (no future dates).";
    if (!(Number.isFinite(r.amount) && r.amount > 0))
      return "Every payment needs an amount above ₹0.";
    if (!(OLD_PAY_METHODS as readonly string[]).includes(r.method))
      return "Pick the payment mode (Cash, UPI, Card, Bank Transfer or Other).";
  }
  return "";
}

export const oldRowsTotal = (rows: Pick<OldPayRow, "amount">[]) =>
  round(rows.reduce((n, r) => n + (Number(r.amount) || 0), 0));

/** A plan's rows before staff change anything: all of it paid on its start day. */
export function defaultOldRows(start: string, amount: number, today: string): OldPayRow[] {
  if (!(amount > 0)) return [];
  return [
    {
      date: ISO.test(start) && start <= today ? start : today,
      amount: round(amount),
      method: "Other",
    },
  ];
}

const sameRow = (a: OldPayRow, b: OldPayRow) =>
  a.date === b.date && round(a.amount) === round(b.amount) && a.method === b.method;

/** Saving a plan's rows: which records change, which are new, which go. */
export function diffOldRows(existing: OldPayRow[], next: OldPayRow[]) {
  const before = new Map(existing.filter((r) => r.id).map((r) => [r.id!, r] as const));
  const kept = new Set<string>();
  const update: { id: string; row: OldPayRow }[] = [];
  const add: OldPayRow[] = [];
  for (const r of next) {
    const old = r.id ? before.get(r.id) : undefined;
    if (old && r.id && !kept.has(r.id)) {
      kept.add(r.id);
      if (!sameRow(old, r)) update.push({ id: r.id, row: r });
    } else {
      const { id: _id, ...fresh } = r;
      add.push(fresh);
    }
  }
  const remove = [...before.keys()].filter((id) => !kept.has(id));
  return { update, add, remove, changed: update.length + add.length + remove.length > 0 };
}

/* ------------------------------------------------------------------ owner tool: backfill */

/** A plan marked "paid in the old software", as the owner tool reads it. */
export interface OldPlanFact {
  kind: "gym" | "pt";
  id: string;
  clientId: string;
  clientName: string;
  /** Package name. */
  name: string;
  startDate: string;
  status: string;
  /** What was paid there (₹, `oldSoftwarePaid`). */
  paid: number;
  billNo: string;
  enrollmentId: string;
  invoiceId: string;
  /** Gym: the package price here. PT: the PT price here. */
  price: number;
  /** PT: the trainer's ₹ share of `price`. */
  trainerShare: number;
  /** Already has its old-software payment record(s). */
  counted: boolean;
}

export interface OldBackfillItem {
  clientId: string;
  clientName: string;
  membershipId: string | null;
  ptAssignmentId: string | null;
  label: string;
  date: string;
  amount: number;
  billNo: string;
  split: OldSplit;
}

export type OldSkipReason =
  "cancelled" | "no-amount" | "no-date" | "with-gym-plan" | "with-pt-plan";

export interface OldBackfill {
  add: OldBackfillItem[];
  total: number;
  /** Added money per month (YYYY-MM), oldest first. */
  months: { month: string; amount: number; plans: number }[];
  /** Plans that already have their payment records. */
  counted: number;
  skipped: {
    id: string;
    kind: "gym" | "pt";
    clientName: string;
    label: string;
    reason: OldSkipReason;
  }[];
}

/** The gym plan a PT plan was one old plan with: joined together, or on the same bill. */
const partnerOf = (p: OldPlanFact, gyms: OldPlanFact[]) =>
  gyms.find(
    (g) =>
      g.clientId === p.clientId &&
      g.status !== "cancelled" &&
      ((p.enrollmentId && g.enrollmentId === p.enrollmentId) ||
        (p.invoiceId && g.invoiceId === p.invoiceId)) &&
      (p.paid <= 0 || round(p.paid) === round(g.paid)),
  ) ?? null;

/**
 * Which plans get an old-software payment: one per old plan (a gym + PT plan that were one old
 * plan share it), on its start day (today for a plan that starts later), for what was paid there.
 */
export function planOldBackfill(plans: OldPlanFact[], today: string): OldBackfill {
  const out: OldBackfill = { add: [], total: 0, months: [], counted: 0, skipped: [] };
  const skip = (p: OldPlanFact, reason: OldSkipReason) =>
    out.skipped.push({ id: p.id, kind: p.kind, clientName: p.clientName, label: p.name, reason });
  const gyms = plans.filter((p) => p.kind === "gym");
  const pts = plans.filter((p) => p.kind === "pt");
  const withGym = new Map<string, OldPlanFact>();
  for (const p of pts) {
    if (p.status === "cancelled") continue;
    const g = partnerOf(p, gyms);
    if (g) withGym.set(g.id, p);
  }
  const usedPt = new Set<string>();
  const item = (lead: OldPlanFact, gym: OldPlanFact | null, pt: OldPlanFact | null): void => {
    const why: OldSkipReason | null =
      lead.status === "cancelled"
        ? "cancelled"
        : !(lead.paid > 0)
          ? "no-amount"
          : !ISO.test(lead.startDate)
            ? "no-date"
            : null;
    if (why) {
      skip(lead, why);
      return;
    }
    out.add.push({
      clientId: lead.clientId,
      clientName: lead.clientName,
      membershipId: gym?.id ?? null,
      ptAssignmentId: pt?.id ?? null,
      label: lead.name,
      date: lead.startDate <= today ? lead.startDate : today,
      amount: round(lead.paid),
      billNo: lead.billNo,
      split: oldMoneySplit(lead.paid, {
        gym: gym ? { price: gym.price } : null,
        pt: pt ? { price: pt.price, trainerShare: pt.trainerShare } : null,
      }),
    });
  };
  for (const g of gyms) {
    const p = withGym.get(g.id) ?? null;
    if (p) usedPt.add(p.id);
    if (g.counted) {
      out.counted += 1;
      // Its PT partner's money is in the gym plan's payment.
      if (p && !p.counted) skip(p, "with-gym-plan");
      continue;
    }
    // Its PT partner has its own payment for the same amount: that was this old plan's money.
    if (p?.counted && p.paid > 0) {
      skip(g, "with-pt-plan");
      continue;
    }
    item(g, g, p && !p.counted ? p : null);
  }
  for (const p of pts) {
    if (usedPt.has(p.id)) {
      if (p.counted) out.counted += 1;
      continue;
    }
    if (p.counted) {
      out.counted += 1;
      continue;
    }
    item(p, null, p);
  }
  out.total = round(out.add.reduce((n, a) => n + a.amount, 0));
  const months = new Map<string, { amount: number; plans: number }>();
  for (const a of out.add) {
    const m = months.get(a.date.slice(0, 7)) ?? { amount: 0, plans: 0 };
    months.set(a.date.slice(0, 7), { amount: round(m.amount + a.amount), plans: m.plans + 1 });
  }
  out.months = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
  return out;
}
