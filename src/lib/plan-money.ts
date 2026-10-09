/**
 * What a plan really costs the member, from its bill: the package price less the plan's share of
 * the bill's discount, less any credit (unused days of an upgraded plan, money paid in the old
 * software), and what is paid and still due. A bill with a gym plan and PT shares its discount,
 * credit, tax and payments by price, like the payment split. The member page and the member app
 * show this, so a plan reads ₹1,699 (package ₹1,999 − ₹300 discount), as in the money lists.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PlanBill {
  subtotal: number;
  /** Staff discount + credits (credits are kept inside the discount). */
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  membershipGross: number;
  ptGross: number;
  upgradeCredit?: number | undefined;
  oldSoftwareCredit?: number | undefined;
  /** A plan on the bill was cancelled (bill-cancel.ts): all that is due is the other plan's. */
  cancelledParts?: Record<string, { kind: "gym" | "pt"; amount: number }> | null | undefined;
}

export interface PlanMoney {
  /** The package price on the bill. */
  price: number;
  /** The staff discount on this plan (its share of the bill's). */
  discount: number;
  /** Credit from an upgraded plan / the old software (its share). */
  credit: number;
  /** price − discount: what the plan was sold for. */
  value: number;
  /** What the member pays for it on this bill (after discount and credit, with any tax). */
  total: number;
  paid: number;
  due: number;
  /** The bill also has another plan: these are this plan's share. */
  shared: boolean;
}

/** The plan's money on its bill; null when there is no bill to read it from. */
export function planMoney(
  kind: "gym" | "pt",
  price: number,
  bill: PlanBill | null | undefined,
): PlanMoney | null {
  if (!bill || !(bill.subtotal > 0)) return null;
  const gross = Math.max(0, (kind === "gym" ? bill.membershipGross : bill.ptGross) || price);
  const ratio = Math.min(gross, bill.subtotal) / bill.subtotal;
  const credits =
    Math.max(0, Number(bill.upgradeCredit) || 0) + Math.max(0, Number(bill.oldSoftwareCredit) || 0);
  const discountAll = Math.max(0, bill.discount);
  const discount = round(Math.max(0, discountAll - credits) * ratio);
  const total = round(Math.max(0, bill.total) * ratio);
  const gone = new Set(Object.values(bill.cancelledParts ?? {}).map((p) => p.kind));
  const due = gone.has(kind)
    ? 0
    : gone.size
      ? Math.max(0, bill.balanceDue)
      : Math.max(0, bill.balanceDue) * ratio;
  return {
    price: round(gross),
    discount,
    credit: round(Math.min(credits, discountAll) * ratio),
    value: round(Math.max(0, gross - discount)),
    total,
    paid: round(Math.max(0, bill.amountPaid) * ratio),
    due: round(due),
    shared: ratio < 1,
  };
}

/**
 * What the member paid for a plan, for crediting its unused days on an upgrade: the price less its
 * discount; a plan carried over from the old software (its bill here is only the balance): what it
 * cost there (paid + balance); no bill: the package price. A sale here later marked "paid in the
 * old software" keeps the whole plan on its bill (the old money is a credit on it): its bill counts.
 */
export function planSoldFor(
  kind: "gym" | "pt",
  plan: {
    price: number;
    paidInOldSoftware?: boolean | undefined;
    oldSoftwarePaid?: number | undefined;
    oldSoftwareBalance?: number | undefined;
  },
  bill: PlanBill | null | undefined,
) {
  const movedFromHere = bill && (Number(bill.oldSoftwareCredit) || 0) > 0;
  if (plan.paidInOldSoftware && !movedFromHere) {
    const there =
      Math.max(0, Number(plan.oldSoftwarePaid) || 0) +
      Math.max(0, Number(plan.oldSoftwareBalance) || 0);
    return there > 0 ? round(there) : Math.max(0, plan.price);
  }
  return planMoney(kind, plan.price, bill)?.value ?? Math.max(0, plan.price);
}

/* ------------------------------------------------------------- the most a refund can be */

export interface RefundPlan {
  id: string;
  kind: "gym" | "pt";
  price: number;
  startDate: string;
  paidInOldSoftware?: boolean | undefined;
  oldSoftwarePaid?: number | undefined;
}

export interface RefundBill {
  membershipId: string | null;
  ptAssignmentId: string | null;
  subtotal: number;
  amountPaid: number;
  membershipGross: number;
  ptGross: number;
}

export interface RefundPayment {
  amount: number;
  oldSoftware?: boolean | undefined;
  membershipId: string | null;
  ptAssignmentId: string | null;
}

/**
 * A plan's share of what was paid on its bill here, by price. A bill that says how much of it was
 * gym and how much PT uses that, even when one is 0 (a gym + PT balance bill from the old software
 * is all "gym"), so the same payment is never counted for both plans.
 */
export function billSharePaid(kind: "gym" | "pt", price: number, bill: RefundBill) {
  if (!(bill.subtotal > 0)) return 0;
  const split = (bill.membershipGross || 0) + (bill.ptGross || 0) > 0;
  const gross = split ? (kind === "gym" ? bill.membershipGross : bill.ptGross) || 0 : price;
  return Math.round(
    (Math.max(0, bill.amountPaid) * Math.min(Math.max(0, gross), bill.subtotal)) / bill.subtotal,
  );
}

/**
 * The most that can be given back when these plans are cancelled: what was paid for them here (their
 * bills' share), plus what was paid for them in the old software, less refunds already given for them.
 * A plan with no bill here and nothing from the old software counts at its price.
 * Old-software money is read from its payment records (one per old plan, a gym + PT pair shares
 * one), else from the plan; a pair without records counts once.
 */
export function refundLimit(
  plans: RefundPlan[],
  bills: RefundBill[],
  payments: RefundPayment[],
): { here: number; old: number; refunded: number; max: number } {
  const ids = new Set(plans.map((p) => p.id));
  const linked = (x: { membershipId: string | null; ptAssignmentId: string | null }) =>
    (!!x.membershipId && ids.has(x.membershipId)) ||
    (!!x.ptAssignmentId && ids.has(x.ptAssignmentId));
  let here = 0;
  for (const p of plans) {
    const bill = bills.find((b) =>
      p.kind === "gym" ? b.membershipId === p.id : b.ptAssignmentId === p.id,
    );
    if (bill) here += billSharePaid(p.kind, p.price, bill);
    else if (!p.paidInOldSoftware) here += Math.max(0, p.price);
  }
  const oldDocs = payments.filter((x) => x.oldSoftware && x.amount > 0 && linked(x));
  let old = oldDocs.reduce((n, x) => n + x.amount, 0);
  const covered = new Set(oldDocs.flatMap((x) => [x.membershipId, x.ptAssignmentId]));
  const seen = new Set<string>();
  for (const p of [...plans].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "gym" ? -1 : 1))) {
    const paid = Math.max(0, Number(p.oldSoftwarePaid) || 0);
    if (!p.paidInOldSoftware || !paid || covered.has(p.id)) continue;
    // Sold together in the old software: the gym and PT plans both carry the whole amount.
    const key = `${p.startDate}|${paid}`;
    if (p.kind === "pt" && seen.has(key)) continue;
    seen.add(key);
    old += paid;
  }
  const refunded = payments
    .filter((x) => x.amount < 0 && linked(x))
    .reduce((n, x) => n - x.amount, 0);
  return {
    here: round(here),
    old: round(old),
    refunded: round(refunded),
    max: round(Math.max(0, here + old - refunded)),
  };
}
