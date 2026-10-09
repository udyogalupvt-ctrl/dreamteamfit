/**
 * What a cancellation does to the bills of the cancelled plans (migration audit 9).
 *
 * A bill of only the cancelled plans (or whose other plan was cancelled before) is closed: its
 * balance is no longer asked for. A gym + PT bill where only one plan is cancelled stays open but
 * stops asking for that plan's unpaid part, worked out by price like the payment split
 * (Gym ₹2,500 + PT ₹12,000, ₹5,000 paid, ₹9,500 due; PT cancelled → ₹7,862 dropped, ₹1,638 still
 * asked for the gym plan). The dropped part is kept on the bill per cancellation
 * (`cancelledParts`, summed in `cancelledDue`), so every balance worked out later is
 * total − paid − dropped, payments after it count for the plan still running, and Undo asks for it
 * again.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type PlanKind = "gym" | "pt";
/** Per cancellation: the plan, its dropped part, and what the bill had paid at that moment. */
export type CancelledParts = Record<
  string,
  { kind: PlanKind; amount: number; paidThen?: number | undefined }
>;

export interface CancelBill {
  id: string;
  invoiceNumber: string;
  membershipId: string | null;
  ptAssignmentId: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
  membershipGross: number;
  ptGross: number;
  trainerShareTotal: number;
  cancelledDue?: number | undefined;
  cancelledParts?: CancelledParts | null | undefined;
}

/** Money on the bill no longer asked for because one of its plans was cancelled. */
export function cancelledDueOf(b: {
  cancelledDue?: number | undefined;
  cancelledParts?: CancelledParts | null | undefined;
}) {
  const parts = Object.values(b.cancelledParts ?? {});
  if (parts.length) return round(parts.reduce((n, p) => n + Math.max(0, Number(p.amount) || 0), 0));
  return Math.max(0, Number(b.cancelledDue) || 0);
}

/** The plan kinds on the bill whose unpaid part was dropped. */
export const cancelledKinds = (b: { cancelledParts?: CancelledParts | null | undefined }) =>
  new Set(Object.values(b.cancelledParts ?? {}).map((p) => p.kind));

/** What the bill still asks for. */
export const billOwed = (total: number, paid: number, dropped = 0) =>
  round(Math.max(0, total - paid - Math.max(0, dropped)));

/**
 * The bill's status. With nothing dropped, as always (paid / partial / pending). With a dropped
 * part: paid once the rest is paid, Closed when nothing was paid and nothing is asked.
 */
export function billStatus(total: number, paid: number, dropped = 0) {
  if (!(dropped > 0)) return total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
  if (billOwed(total, paid, dropped) > 0) return paid > 0 ? "partial" : "pending";
  return paid > 0 ? "paid" : "closed";
}

/** The plan's unpaid part of the bill: what is due now, shared by price. */
export function shareDue(bill: CancelBill, kind: PlanKind, price: number) {
  if (!(bill.subtotal > 0) || !(bill.balanceDue > 0)) return 0;
  const split = (bill.membershipGross || 0) + (bill.ptGross || 0) > 0;
  const gross = split ? (kind === "gym" ? bill.membershipGross : bill.ptGross) || 0 : price;
  // Whole rupees, like the payment split (billSharePaid).
  return Math.round(
    (bill.balanceDue * Math.min(Math.max(0, gross), bill.subtotal)) / bill.subtotal,
  );
}

export interface LowerBill {
  bill: CancelBill;
  /** The cancelled plan on it. */
  kind: PlanKind;
  /** Its unpaid part, no longer asked for. */
  amount: number;
  /** What the bill still asks for (the other plan's part). */
  left: number;
}

/**
 * The bills of the plans being cancelled (`ids`) that have money still due: `close` (nothing on
 * them keeps running) and `lower` (a gym + PT bill whose other plan keeps running).
 * `priceOf` = each cancelled plan's price, for bills without the gym / PT split.
 */
export function cancelBills<B extends CancelBill>(
  bills: B[],
  ids: Set<string>,
  priceOf: Record<string, number>,
): { close: B[]; lower: (LowerBill & { bill: B })[] } {
  const close: B[] = [];
  const lower: (LowerBill & { bill: B })[] = [];
  for (const b of bills) {
    if (!(b.balanceDue > 0)) continue;
    if (b.paymentStatus === "refunded" || b.paymentStatus === "closed") continue;
    const linked: { kind: PlanKind; id: string }[] = [];
    if (b.membershipId) linked.push({ kind: "gym", id: b.membershipId });
    if (b.ptAssignmentId) linked.push({ kind: "pt", id: b.ptAssignmentId });
    const hit = linked.filter((l) => ids.has(l.id));
    if (!hit.length) continue;
    const gone = cancelledKinds(b);
    const rest = linked.filter((l) => !ids.has(l.id) && !gone.has(l.kind));
    if (!rest.length || hit.length !== 1) {
      close.push(b);
      continue;
    }
    const h = hit[0]!;
    const amount = Math.min(b.balanceDue, shareDue(b, h.kind, priceOf[h.id] ?? 0));
    if (amount > 0)
      lower.push({ bill: b, kind: h.kind, amount, left: round(b.balanceDue - amount) });
  }
  return { close, lower };
}

/**
 * The bill as the payment split should see it once a plan on it was cancelled: only the plan still
 * running (and any other items), so a later payment never counts as the cancelled plan's money (no
 * trainer share for a cancelled PT).
 */
export function keptAllocationBill<
  B extends Pick<
    CancelBill,
    "subtotal" | "discount" | "total" | "membershipGross" | "ptGross" | "trainerShareTotal"
  > & { cancelledParts?: CancelledParts | null | undefined },
>(b: B) {
  const gone = cancelledKinds(b);
  const base = {
    total: b.total,
    subtotal: b.subtotal,
    discount: b.discount,
    membershipGross: b.membershipGross,
    ptGross: b.ptGross,
    trainerShareTotal: b.trainerShareTotal,
  };
  if (!gone.size || !(b.subtotal > 0)) return base;
  const gym = gone.has("gym") ? 0 : b.membershipGross;
  const pt = gone.has("pt") ? 0 : b.ptGross;
  const dropped = (gone.has("gym") ? b.membershipGross : 0) + (gone.has("pt") ? b.ptGross : 0);
  const kept = Math.max(0, b.subtotal - dropped);
  const ratio = kept / b.subtotal;
  return {
    total: round(b.total * ratio),
    subtotal: round(kept),
    discount: round(b.discount * ratio),
    membershipGross: gym,
    ptGross: pt,
    trainerShareTotal: gone.has("pt") ? 0 : b.trainerShareTotal,
  };
}

/** What the bill had paid when a plan on it was cancelled (the most of its dropped parts). */
export const paidAtCancel = (b: { cancelledParts?: CancelledParts | null | undefined }) =>
  Math.max(0, ...Object.values(b.cancelledParts ?? {}).map((p) => Number(p.paidThen) || 0));

/**
 * Taking back a payment on a bill with a dropped part: only money collected after the cancel can
 * go (it was all for the plan still running). Money paid before it was split with the cancelled
 * plan, so removing it would ask for the cancelled plan's money again. "" = it can go.
 */
export function takeBackBlocked(
  b: {
    invoiceNumber: string;
    amountPaid: number;
    cancelledParts?: CancelledParts | null | undefined;
  },
  amount: number,
) {
  const then = paidAtCancel(b);
  if (!(then > 0) || b.amountPaid - amount >= then - 0.005) return "";
  return `A plan on bill ${b.invoiceNumber} was cancelled after this money was paid: Restore that plan first.`;
}

/**
 * Undo of cancellation `cancelId` on a bill it lowered: the dropped part is asked for again.
 * When a later cancellation closed the bill since, its saved balance grows instead (its own Undo
 * puts that back). null = this cancellation didn't lower the bill. Refused (`error`) when money was
 * collected on the bill since: that was booked all to the plan still running.
 */
export function restorePart(
  b: Pick<CancelBill, "total" | "amountPaid" | "cancelledDue" | "cancelledParts"> & {
    invoiceNumber?: string;
    paymentStatus: string;
    closedAmount?: number | undefined;
    beforeCancel?: { balanceDue: number; paymentStatus: string } | null | undefined;
  },
  cancelId: string,
) {
  const part = b.cancelledParts?.[cancelId];
  if (!part) return null;
  if (part.paidThen !== undefined && Math.abs(b.amountPaid - part.paidThen) > 0.005)
    return {
      error: `Money was collected on bill ${b.invoiceNumber ?? ""} after the plan was cancelled (it counts for the other plan). Remove that payment first, then Restore.`,
    };
  const parts = { ...b.cancelledParts };
  delete parts[cancelId];
  const dropped = cancelledDueOf({ cancelledParts: parts });
  const keep = Object.keys(parts).length ? parts : null;
  if (b.paymentStatus === "closed" && b.beforeCancel)
    return {
      cancelledDue: dropped,
      cancelledParts: keep,
      // Still written off, now by the cancellation that closed it.
      closedAmount: round((Number(b.closedAmount) || 0) + part.amount),
      beforeCancel: {
        balanceDue: round(b.beforeCancel.balanceDue + part.amount),
        paymentStatus: billStatus(b.total, b.amountPaid, dropped),
      },
    };
  return {
    cancelledDue: dropped,
    cancelledParts: keep,
    balanceDue: billOwed(b.total, b.amountPaid, dropped),
    paymentStatus: billStatus(b.total, b.amountPaid, dropped),
  };
}
