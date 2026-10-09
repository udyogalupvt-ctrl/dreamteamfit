/**
 * Removing a gym or PT plan added by mistake: it is taken out as if it was never added (not
 * cancelled). The whole sale goes to the Recycle Bin: the plans on its bill, the bill, its payments
 * and refunds, the trainer's share and the joining record. Plans the sale changed come back as
 * they were (an upgraded plan gets its end date back, a plan a renewal ended runs again).
 *
 * Which records go, what comes back and when it is refused. Pure maths only (no database):
 * relative imports, unit-tested with `node --test`.
 */

import { pickCurrent, type CurrentSummary } from "./current-plan.ts";

export { pickCurrent, type CurrentSummary };

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface RmPlan {
  kind: "gym" | "pt";
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  /** The bill it was sold on ("" = none, e.g. paid in the old software). */
  invoiceId: string;
  /** The joining record of its sale ("" = none). */
  enrollmentId: string;
  cancelId: string;
  /**
   * When it was made and last changed (ms, 0 = not known). A sale ends the plans it cuts short in
   * the same write that makes it, so their last change is the sale's own time.
   */
  createdMs: number;
  updatedMs: number;
  /** Gym only ("" when not set): the plan it was upgraded to, and its end date before that. */
  upgradedTo: string;
  originalEndDate: string;
  /** Gym only: the renewal that ended it ("" = not stamped). */
  endedBy: string;
}

export interface RmBill {
  id: string;
  invoiceNumber: string;
  membershipId: string;
  ptAssignmentId: string;
  enrollmentId: string;
  publicToken: string;
  total: number;
  /** Credit for an upgraded plan's unused days (> 0 = this bill was an upgrade). */
  upgradeCredit: number;
}

export interface RmPayment {
  id: string;
  amount: number;
  paymentDate: string;
  method: string;
  kind: string;
  oldSoftware: boolean;
  invoiceId: string;
  membershipId: string;
  ptAssignmentId: string;
  cancelId: string;
}

export interface RmPayout {
  id: string;
  trainerName: string;
  ptAssignmentId: string;
  invoiceId: string;
  cancelId: string;
  status: string;
  trainerShareAmount: number;
}

export interface RemovalFacts {
  target: { kind: "gym" | "pt"; id: string };
  /** All the member's gym and PT plans. */
  plans: RmPlan[];
  /** All the member's bills, payments and trainer payouts. */
  bills: RmBill[];
  payments: RmPayment[];
  payouts: RmPayout[];
  /** The member's current plan id ("" = none) and joining record they still point to. */
  client: { currentId: string; enrollmentId: string };
  today: string;
  /** First day the Day Book can still change (cashOpenFrom). */
  openFrom: string;
}

/** A plan the sale changed, as it comes back. */
export interface PutBack {
  kind: "gym" | "pt";
  id: string;
  name: string;
  status: string;
  endDate: string;
  /** Fields taken off it. */
  clear: string[];
  why: "upgrade" | "renewal";
}

export interface RemovalPlan {
  error: string;
  /** The sale's plans (the chosen one first). */
  plans: { kind: "gym" | "pt"; id: string }[];
  billIds: string[];
  publicTokens: string[];
  paymentIds: string[];
  payoutIds: string[];
  enrollmentIds: string[];
  putBack: PutBack[];
  /** The member's current plan afterwards; undefined = it stays as it is. */
  current?: { summary: CurrentSummary | null; active: boolean };
  /** The member points to a joining record that goes: the link is cleared. */
  clearEnrollment: boolean;
  /** For the confirm dialog: what goes, what comes back, and what the money does. */
  goes: string[];
  back: string[];
  money: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const rupees = (n: number) => inr.format(Math.abs(n));

const label = (p: Pick<RmPlan, "kind" | "name">) => (p.kind === "pt" ? `PT: ${p.name}` : p.name);

/** Status a plan goes back to, from its dates. */
export function statusByDates(
  kind: "gym" | "pt",
  startDate: string,
  endDate: string,
  today: string,
) {
  if (endDate < today) return kind === "gym" ? "expired" : "completed";
  return startDate > today ? "pending" : "active";
}

/** What removing the plan takes out and puts back, or why it can't. */
export function planRemoval(f: RemovalFacts): RemovalPlan {
  const empty: RemovalPlan = {
    error: "",
    plans: [],
    billIds: [],
    publicTokens: [],
    paymentIds: [],
    payoutIds: [],
    enrollmentIds: [],
    putBack: [],
    clearEnrollment: false,
    goes: [],
    back: [],
    money: "",
  };
  const fail = (error: string): RemovalPlan => ({ ...empty, error });
  const key = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;
  const target = f.plans.find((p) => key(p) === key(f.target));
  if (!target) return fail("That plan was already removed.");

  // ---- The sale: grow from the chosen plan until nothing changes.
  const sale = new Map<string, RmPlan>([[key(target), target]]);
  const bills = new Map<string, RmBill>();
  const has = (kind: "gym" | "pt", id: string) => !!id && sale.has(`${kind}:${id}`);
  for (let grew = true; grew;) {
    grew = false;
    const add = (p: RmPlan | undefined) => {
      if (p && !sale.has(key(p))) {
        sale.set(key(p), p);
        grew = true;
      }
    };
    const plan = (kind: "gym" | "pt", id: string) =>
      id ? f.plans.find((p) => p.kind === kind && p.id === id) : undefined;
    // 1. Its bill, and every plan on that bill (a gym + PT sold together goes together).
    for (const b of f.bills) {
      const linked =
        [...sale.values()].some((p) => p.invoiceId === b.id) ||
        has("gym", b.membershipId) ||
        has("pt", b.ptAssignmentId);
      if (!linked) continue;
      bills.set(b.id, b);
      add(plan("gym", b.membershipId));
      add(plan("pt", b.ptAssignmentId));
      f.plans.filter((p) => p.invoiceId === b.id).forEach(add);
    }
    // 2. An old gym + PT pair shares one old-software payment.
    for (const pay of f.payments)
      if (pay.oldSoftware && (has("gym", pay.membershipId) || has("pt", pay.ptAssignmentId))) {
        add(plan("gym", pay.membershipId));
        add(plan("pt", pay.ptAssignmentId));
      }
    // 3. One joining record = one sale.
    const joined = new Set([...sale.values()].map((p) => p.enrollmentId).filter(Boolean));
    f.plans.filter((p) => p.enrollmentId && joined.has(p.enrollmentId)).forEach(add);
  }
  const plans = [...sale.values()];
  const gymIds = new Set(plans.filter((p) => p.kind === "gym").map((p) => p.id));
  const ptIds = new Set(plans.filter((p) => p.kind === "pt").map((p) => p.id));

  // ---- Refused: what can't be undone this way.
  for (const p of plans) {
    if (p.status !== "cancelled" || !p.cancelId) continue;
    const outside = f.plans.filter((q) => q.cancelId === p.cancelId && !sale.has(key(q)));
    if (outside.length)
      return fail(
        `${label(p)} was cancelled together with ${outside.map(label).join(", ")}. Restore it first, then remove this plan.`,
      );
  }
  for (const p of plans) {
    if (p.kind !== "gym" || !p.upgradedTo || gymIds.has(p.upgradedTo)) continue;
    const to = f.plans.find((q) => q.kind === "gym" && q.id === p.upgradedTo);
    if (to) return fail(`${label(p)} was upgraded to ${label(to)}: remove ${label(to)} first.`);
  }
  const cancelIds = new Set(plans.map((p) => p.cancelId).filter(Boolean));
  const otherCancel = (x: { cancelId: string }) => !!x.cancelId && !cancelIds.has(x.cancelId);
  const billIds = new Set(bills.keys());
  const payments = f.payments.filter(
    (x) =>
      !otherCancel(x) &&
      ((!!x.invoiceId && billIds.has(x.invoiceId)) ||
        (!!x.cancelId && cancelIds.has(x.cancelId)) ||
        (!!x.membershipId && gymIds.has(x.membershipId)) ||
        (!!x.ptAssignmentId && ptIds.has(x.ptAssignmentId))),
  );
  const payouts = f.payouts.filter(
    (x) =>
      (!!x.ptAssignmentId && ptIds.has(x.ptAssignmentId)) ||
      (!!x.invoiceId && billIds.has(x.invoiceId)) ||
      (!!x.cancelId && cancelIds.has(x.cancelId)),
  );
  const stillCancelled = target.status === "cancelled";
  const instead = stillCancelled
    ? "it can't be removed (it stays cancelled)"
    : "use Cancel instead";
  const paid = payouts.find((x) => x.status === "paid");
  if (paid)
    return fail(
      `Trainer ${paid.trainerName} was already paid ${rupees(paid.trainerShareAmount)} for this: ${stillCancelled ? "it can't be removed (it stays cancelled)" : "use Cancel (their next payout goes down)"}.`,
    );
  const closed = payments.find((x) => !x.oldSoftware && x.paymentDate < f.openFrom);
  if (closed)
    return fail(
      `${rupees(closed.amount)} ${closed.amount < 0 ? "given back" : "paid"} on ${nice(closed.paymentDate)} is in a closed Day Book month (before ${nice(f.openFrom)}): ${instead}.`,
    );

  // ---- Put back: plans the sale changed.
  const putBack: PutBack[] = [];
  const upgraded = f.plans.filter(
    (q) => q.kind === "gym" && !!q.upgradedTo && gymIds.has(q.upgradedTo) && !sale.has(key(q)),
  );
  for (const q of upgraded) {
    if (q.status === "cancelled")
      return fail(
        `${label(q)}, the plan this upgraded, is cancelled: change the plans with Edit plan instead.`,
      );
    if (!q.originalEndDate)
      return fail(
        `${label(q)}'s end date before the upgrade is not known: change the plans with Edit plan instead.`,
      );
    putBack.push({
      kind: "gym",
      id: q.id,
      name: q.name,
      status: statusByDates("gym", q.startDate, q.originalEndDate, f.today),
      endDate: q.originalEndDate,
      clear: ["upgradedTo", "upgradeFrom", "upgradeCredit", "originalEndDate"],
      why: "upgrade",
    });
  }
  if ([...bills.values()].some((b) => b.upgradeCredit > 0) && !upgraded.length)
    return fail(
      "The plan this upgraded is no longer here: change the plans with Edit plan instead.",
    );
  // A renewal ended the plan running then (stamped since 2026-10-09).
  const stamped = f.plans.filter(
    (q) =>
      q.kind === "gym" &&
      !!q.endedBy &&
      gymIds.has(q.endedBy) &&
      !sale.has(key(q)) &&
      q.status === "expired",
  );
  for (const q of stamped)
    putBack.push({
      kind: "gym",
      id: q.id,
      name: q.name,
      status: statusByDates("gym", q.startDate, q.endDate, f.today),
      endDate: q.endDate,
      clear: ["endedBy", "statusBeforeSale"],
      why: "renewal",
    });
  const after = (q: RmPlan) => {
    const b = putBack.find((x) => x.kind === q.kind && x.id === q.id);
    return b ? { ...q, status: b.status, endDate: b.endDate } : q;
  };
  const remaining = f.plans.filter((q) => q.kind === "gym" && !sale.has(key(q))).map(after);
  // Older sales (no stamp): a plan ended in the same write that made the sale (its last change is
  // the sale's own time), its end date still ahead, runs again if no other plan runs now.
  const saleTimes = new Set(
    plans.filter((p) => p.kind === "gym" && p.createdMs > 0).map((p) => p.createdMs),
  );
  const runs = (q: RmPlan) =>
    q.status !== "cancelled" &&
    q.status !== "expired" &&
    q.startDate <= f.today &&
    q.endDate >= f.today;
  if (!stamped.length && saleTimes.size && !remaining.some(runs)) {
    const cut = remaining
      .filter(
        (q) =>
          q.status === "expired" &&
          !q.upgradedTo &&
          !q.endedBy &&
          saleTimes.has(q.updatedMs) &&
          q.startDate <= f.today &&
          q.endDate >= f.today,
      )
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    if (cut)
      putBack.push({
        kind: "gym",
        id: cut.id,
        name: cut.name,
        status: "active",
        endDate: cut.endDate,
        clear: [],
        why: "renewal",
      });
  }

  // ---- The member's current plan: worked out again when it was one of these.
  const touched = new Set([...gymIds, ...putBack.map((x) => x.id)]);
  const current =
    (f.client.currentId && touched.has(f.client.currentId)) ||
    (!f.client.currentId && putBack.length)
      ? pickCurrent(
          f.plans.filter((q) => q.kind === "gym" && !sale.has(key(q))).map(after),
          f.today,
        )
      : undefined;

  const enrollmentIds = [
    ...new Set(
      [
        ...plans.map((p) => p.enrollmentId),
        ...[...bills.values()].map((b) => b.enrollmentId),
      ].filter(Boolean),
    ),
  ];

  // ---- For the dialog.
  const goes = [
    ...plans.map(
      (p) =>
        `${label(p)} · ${nice(p.startDate)} → ${nice(p.endDate)}${p.status === "cancelled" ? " (cancelled)" : ""}`,
    ),
    ...[...bills.values()].map((b) => `Bill ${b.invoiceNumber} · ${rupees(b.total)}`),
    ...payments.map((x) =>
      x.oldSoftware
        ? `Paid in the old software ${rupees(x.amount)} · ${nice(x.paymentDate)}`
        : `${x.amount < 0 ? "Given back −" : "Payment "}${rupees(x.amount)} ${x.method} · ${nice(x.paymentDate)}`,
    ),
    ...payouts.map(
      (x) => `${x.trainerName}'s trainer share ${rupees(x.trainerShareAmount)} (not paid yet)`,
    ),
  ];
  const back = putBack.map((x) =>
    x.why === "upgrade"
      ? `${x.name} gets its end date back: ${nice(x.endDate)}`
      : x.status === "active"
        ? `${x.name} runs again until ${nice(x.endDate)}`
        : `${x.name} comes back (${nice(x.endDate)})`,
  );
  const here = payments.filter((x) => !x.oldSoftware);
  const old = payments.filter((x) => x.oldSoftware);
  const hereNet = round(here.reduce((n, x) => n + x.amount, 0));
  const oldNet = round(old.reduce((n, x) => n + x.amount, 0));
  const money = [
    here.length
      ? hereNet === 0
        ? "These payments add up to ₹0: Collected, income and the Day Book don't change."
        : `Collected, income and the Day Book go ${hereNet > 0 ? "down" : "up"} by ${rupees(hereNet)}.`
      : "",
    old.length && oldNet !== 0
      ? `${rupees(oldNet)} paid in the old software comes out of income (it was never in the Day Book).`
      : "",
    !here.length && !old.length ? "No money was recorded for it: Collected doesn't change." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    error: "",
    plans: plans.map((p) => ({ kind: p.kind, id: p.id })),
    billIds: [...billIds],
    publicTokens: [...bills.values()].map((b) => b.publicToken).filter(Boolean),
    paymentIds: payments.map((x) => x.id),
    payoutIds: payouts.map((x) => x.id),
    enrollmentIds,
    putBack,
    ...(current ? { current } : {}),
    clearEnrollment: !!f.client.enrollmentId && enrollmentIds.includes(f.client.enrollmentId),
    goes,
    back,
    money,
  };
}
