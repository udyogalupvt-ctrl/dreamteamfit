/**
 * Removing a payment entered by mistake (the owner, on the member's Payments list): the payment
 * goes to the Recycle Bin and its bill shows the money as not paid again, so Collected, the Day
 * Book, income and the CFO drop by it. It can be put back (Undo / Recycle Bin).
 *
 * Which entries can go, and what their bill becomes. Pure maths only (no database): relative
 * imports, unit-tested with `node --test`.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface RemovePayment {
  amount: number;
  paymentDate: string;
  kind: string;
  oldSoftware: boolean;
  invoiceId: string;
  trainerShareAmount: number;
  cancelId: string;
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

const statusOf = (total: number, paid: number) =>
  total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";

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
  // Like Edit payment: older days are closed in the Day Book (their cash is carried forward).
  if (p.paymentDate < openFrom)
    return fail(
      `It is dated ${nice(p.paymentDate)}, in a closed Day Book month (before ${nice(openFrom)}): it can't be removed.`,
    );
  if (p.amount < 0) {
    if (p.kind !== "refund" || !p.cancelId)
      return fail(
        "This money given back belongs to a bill change: correct it with Edit bill or Edit plan.",
      );
    if (round(p.trainerShareAmount) !== 0)
      return fail(
        "This refund also took back a trainer's share: use Restore on the cancelled plan instead.",
      );
    // A cancellation's refund never changed its bill.
    return { error: "", bill: null };
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
  const paid = round(Math.max(0, bill.amountPaid - p.amount));
  const before: RemoveBillState = {
    amountPaid: round(bill.amountPaid),
    balanceDue: round(bill.balanceDue),
    paymentStatus: bill.paymentStatus,
    closedAmount:
      bill.paymentStatus === "closed" || bill.closedAmount ? round(bill.closedAmount) : null,
    cancelId: bill.cancelId || null,
    beforeCancel: bill.beforeCancel,
  };
  const owed = round(Math.max(0, bill.total - paid));
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
          paymentStatus: owed > 0 ? "closed" : statusOf(bill.total, paid),
          closedAmount: owed > 0 ? owed : before.closedAmount,
          cancelId: cancelId || null,
          beforeCancel: cancelId
            ? {
                balanceDue: owed,
                paymentStatus: statusOf(bill.total, paid),
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
        paymentStatus: statusOf(bill.total, paid),
      },
    },
  };
}
