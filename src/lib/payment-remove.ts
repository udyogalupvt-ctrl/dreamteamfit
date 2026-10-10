/**
 * Removing a payment entered by mistake (the owner, on the member's Payments list): the payment
 * goes to the Recycle Bin and its bill shows the money as not paid again, so Collected, the Day
 * Book, income and the CFO drop by it. It can be put back (Undo / Recycle Bin).
 *
 * Which entries can go, and what their bill becomes. Pure maths only (no database): relative
 * imports, unit-tested with `node --test`.
 */

import { billOwed, billStatus, takeBackBlocked, type CancelledParts } from "./bill-cancel.ts";

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rupee = (n: number) => `₹${round(n).toLocaleString("en-IN")}`;

export interface RemovePayment {
  amount: number;
  paymentDate: string;
  kind: string;
  oldSoftware: boolean;
  invoiceId: string;
  trainerShareAmount: number;
  cancelId: string;
  /** One part of a Cash + UPI payment (lib/split-pay.ts); "" / left out = a whole payment. */
  splitId?: string;
}

export interface RemoveBill {
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
  closedAmount: number;
  cancelId: string;
  beforeCancel: { balanceDue: number; paymentStatus: string } | null;
  /** Unpaid part of a cancelled plan on a gym + PT bill, not asked for (bill-cancel.ts). */
  cancelledDue?: number;
  cancelledParts?: CancelledParts | null;
}

/** The bill's money fields a removal changes (and Undo puts back). */
export interface RemoveBillState {
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
  closedAmount: number | null;
  cancelId: string | null;
  beforeCancel: { balanceDue: number; paymentStatus: string } | null;
}

export interface RemovePlan {
  error: string;
  /** The bill before and after; null = no bill changes. */
  bill: { before: RemoveBillState; after: RemoveBillState } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};

const statusOf = (total: number, paid: number, dropped = 0) => billStatus(total, paid, dropped);

/** The bill's money fields as they stand now (what Undo puts back). */
const stateOf = (b: RemoveBill): RemoveBillState => ({
  amountPaid: round(b.amountPaid),
  balanceDue: round(b.balanceDue),
  paymentStatus: b.paymentStatus,
  closedAmount: b.paymentStatus === "closed" || b.closedAmount ? round(b.closedAmount) : null,
  cancelId: b.cancelId || null,
  beforeCancel: b.beforeCancel,
});

/**
 * @param plans the payment's plans here: their status ("missing" = no longer here) and
 *   cancellation ("" when not cancelled).
 * @param openFrom the first day the Day Book can still change (cashOpenFrom).
 */
export function planRemove(
  p: RemovePayment,
  bill: RemoveBill | null,
  plans: { status: string; cancelId: string }[],
  openFrom: string,
): RemovePlan {
  const fail = (error: string): RemovePlan => ({ error, bill: null });
  // None of its plans runs here any more (cancelled, or no longer here).
  const gone =
    plans.length > 0 && plans.every((x) => x.status === "cancelled" || x.status === "missing");
  const cancelled = gone && plans.some((x) => x.status === "cancelled");
  if (p.oldSoftware) {
    if (!gone)
      return fail(
        "This is the plan's money paid in the old software: change it on the plan (Edit plan → Paid in the old software).",
      );
    // Never in the cash drawer: any day can go.
    return { error: "", bill: null };
  }
  if (p.splitId)
    return fail(
      "This is one part of a Cash + UPI payment: in Edit payment choose one mode first (the two parts become one payment), then remove it.",
    );
  // Like Edit payment: older days are closed in the Day Book (their cash is carried forward).
  if (p.paymentDate < openFrom)
    return fail(
      `It is dated ${nice(p.paymentDate)}, in a closed Day Book month (before ${nice(openFrom)}): it can't be removed.`,
    );
  if (p.amount < 0) {
    if (p.kind !== "refund")
      return fail(
        "This money given back belongs to a bill change: correct it with Edit bill or Edit plan.",
      );
    if (round(p.trainerShareAmount) !== 0)
      return fail(
        "This refund also took back a trainer's share: use Restore on the cancelled plan instead.",
      );
    // A cancellation's refund never changed its bill.
    if (p.cancelId) return { error: "", bill: null };
    // Money the app gave back when a bill's price was lowered. Often no money really left the
    // drawer (the price was simply typed wrong), so it can be taken off: the bill then shows that
    // money as paid again, which only works while the bill still has room for it.
    if (!p.invoiceId || !bill) return fail("This payment's bill was not found.");
    if (bill.paymentStatus === "refunded")
      return fail(`Bill ${bill.invoiceNumber} was refunded: it can't change.`);
    const owedNow = Math.max(0, Number(bill.cancelledDue) || 0);
    const asked = round(bill.total - owedNow);
    const back = round(bill.amountPaid - p.amount);
    if (back > asked + 0.005)
      return fail(
        `Taking this off would show ${rupee(back)} paid on a ${rupee(asked)} bill. First set the payment to ${rupee(asked)} with Edit payment, then take this off.`,
      );
    const was = stateOf(bill);
    return {
      error: "",
      bill: {
        before: was,
        after: {
          ...was,
          amountPaid: back,
          balanceDue: billOwed(bill.total, back, owedNow),
          paymentStatus: statusOf(bill.total, back, owedNow),
        },
      },
    };
  }
  if (!(p.amount > 0)) return fail("This payment is ₹0: nothing to remove.");
  if (!p.invoiceId || !bill) return fail("This payment's bill was not found.");
  if (bill.paymentStatus === "refunded")
    return fail(`Bill ${bill.invoiceNumber} was refunded: it can't change.`);
  if (p.kind === "initial" && round(p.trainerShareAmount) !== 0)
    return fail(
      "This payment includes a trainer's PT share (already on their pay list): cancel the PT plan instead.",
    );
  if (p.amount > bill.amountPaid + 0.005)
    return fail(
      `Bill ${bill.invoiceNumber} shows less paid than this payment: correct it with Edit bill.`,
    );
  const blocked = takeBackBlocked(bill, p.amount);
  if (blocked) return fail(blocked);
  const paid = round(Math.max(0, bill.amountPaid - p.amount));
  const before = stateOf(bill);
  const dropped = Math.max(0, Number(bill.cancelledDue) || 0);
  const owed = billOwed(bill.total, paid, dropped);
  if (cancelled || bill.paymentStatus === "closed") {
    // Its plan is cancelled: the money is not asked for (the bill stays Closed). Restoring the
    // cancelled plan asks for it again, as for a balance closed when it was cancelled.
    const cancelId = bill.cancelId || plans.find((x) => x.cancelId)?.cancelId || "";
    return {
      error: "",
      bill: {
        before,
        after: {
          amountPaid: paid,
          balanceDue: 0,
          paymentStatus: owed > 0 ? "closed" : statusOf(bill.total, paid, dropped),
          closedAmount: owed > 0 ? owed : before.closedAmount,
          cancelId: cancelId || null,
          beforeCancel: cancelId
            ? {
                balanceDue: owed,
                paymentStatus: statusOf(bill.total, paid, dropped),
              }
            : bill.beforeCancel,
        },
      },
    };
  }
  return {
    error: "",
    bill: {
      before,
      after: {
        ...before,
        amountPaid: paid,
        balanceDue: owed,
        paymentStatus: statusOf(bill.total, paid, dropped),
      },
    },
  };
}
