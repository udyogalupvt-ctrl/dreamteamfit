import {
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { billTaxRate, calculateInvoiceTotals } from "@/lib/invoice-utils";
import type { Invoice, Membership, MembershipEdit } from "@/types/models";
import { allocatePayment, cashOpenFrom } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * "Paid in the old software": a plan that was entered as a sale here (a payment dated the day it
 * was typed in) although the member had paid for it in the old software. The money is moved out
 * of this app's collections (Collected, Day Book, income, reports, CFO, incentives all add up
 * payments), exactly as if the plan had been saved with "Paid in the old software" ticked:
 *
 * - the bill's payments are taken off (up to the amount paid in the old software; a payment that
 *   was partly real money keeps the rest), the bill keeps its link and shows the old amount as
 *   "Paid in the old software" (a credit inside its discount, like an upgrade credit), so what is
 *   still owed stays owed;
 * - the plan (and a PT plan on the same bill) is marked paid in the old software, with the amount;
 * - a trainer share for money that never came in here is cancelled (refused when already paid).
 *
 * Everything as it was before is saved in oldSoftwareMoves/{id}, so Undo puts it back exactly.
 * Owner only (Income & expenses). Not for money in a closed Day Book month or a bill with a refund.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface OldMoveRow {
  id: string;
  data: DocumentData;
}

export interface OldMovePlan {
  error: string;
  /** What the bill paid here (money in this app). */
  paidHere: number;
  /** Payments taken off (whole) and payments lowered (part was real money). */
  remove: { id: string; amount: number; date: string }[];
  lower: { id: string; from: number; to: number; date: string }[];
  after: {
    total: number;
    amountPaid: number;
    balanceDue: number;
    /** All the bill's old-software money (this move and any earlier one). */
    credit: number;
    /** The bill's new discount (staff discount + credits, before tax) and tax. */
    discount: number;
    tax: number;
  };
  /** Trainer shares cancelled (the PT money was paid in the old software). */
  cancelPayouts: string[];
}

/** Works out the move from the bill and its payments / payouts (as read from the database). */
export function planOldMove(
  bill: Invoice | null,
  payments: OldMoveRow[],
  payouts: OldMoveRow[],
  amount: number,
  today = todayISO(),
): OldMovePlan {
  const empty = { total: 0, amountPaid: 0, balanceDue: 0, credit: 0, discount: 0, tax: 0 };
  const out: OldMovePlan = {
    error: "",
    paidHere: 0,
    remove: [],
    lower: [],
    after: empty,
    cancelPayouts: [],
  };
  if (!bill) return out;
  const positive = payments
    .map((p) => ({
      id: p.id,
      amount: Number(p.data["amount"] ?? 0),
      date: String(p.data["paymentDate"] ?? ""),
      kind: String(p.data["kind"] ?? ""),
    }))
    .filter((p) => p.amount > 0)
    // The joining payment first, then the oldest.
    .sort(
      (a, b) =>
        (a.kind === "initial" ? -1 : 0) - (b.kind === "initial" ? -1 : 0) ||
        a.date.localeCompare(b.date),
    );
  out.paidHere = round(positive.reduce((n, p) => n + p.amount, 0));
  const x = round(amount);
  const fail = (error: string) => ({ ...out, error });
  if (bill.paymentStatus === "closed" || bill.paymentStatus === "refunded")
    return fail(`Bill ${bill.invoiceNumber} is ${bill.paymentStatus}: it can't change.`);
  if (payments.some((p) => Number(p.data["amount"] ?? 0) < 0))
    return fail("Money was given back on this bill: undo that refund first.");
  if (!(x > 0)) return fail("Enter the amount they paid in the old software.");
  if (x > out.paidHere)
    return fail(
      `Only ${formatPrice(out.paidHere)} was recorded as paid here on bill ${bill.invoiceNumber}.`,
    );
  let left = x;
  for (const p of positive) {
    if (left <= 0) break;
    const take = Math.min(left, p.amount);
    if (take >= p.amount) out.remove.push({ id: p.id, amount: p.amount, date: p.date });
    else out.lower.push({ id: p.id, from: p.amount, to: round(p.amount - take), date: p.date });
    left = round(left - take);
  }
  const lockedFrom = cashOpenFrom(today);
  const closed = [...out.remove, ...out.lower].find((p) => p.date < lockedFrom);
  if (closed)
    return fail(
      `A payment of ${formatDateISO(closed.date)} is in a closed Day Book month (before ${formatDateISO(lockedFrom)}): it can't be moved.`,
    );
  // The bill: the old amount becomes a credit inside its discount (taxed bills: before tax), so its
  // total drops by exactly that much and the balance still owed stays the same.
  const rate = billTaxRate(bill);
  const creditBeforeTax = rate > 0 ? x / (1 + rate / 100) : x;
  const totals = calculateInvoiceTotals(
    bill.items,
    bill.discount + creditBeforeTax,
    { taxEnabled: bill.tax > 0, taxRate: rate },
    0,
  );
  const total = round(Math.max(0, bill.total - x));
  if (Math.abs(totals.total - total) > 0.05)
    return fail("This bill's tax can't be split exactly: change it from Billing instead.");
  const amountPaid = round(bill.amountPaid - x);
  out.after = {
    total,
    amountPaid,
    balanceDue: round(total - amountPaid),
    credit: round((bill.oldSoftwareCredit ?? 0) + x),
    discount: round(bill.discount + creditBeforeTax),
    // The tax that makes the total come out exact (rounding can differ by a paisa).
    tax: bill.tax > 0 ? round(total - (bill.subtotal - round(bill.discount + creditBeforeTax))) : 0,
  };
  // All the bill's money was the old software's: the trainer's share for it never came in here.
  if (amountPaid <= 0) {
    const paid = payouts.find((p) => p.data["status"] === "paid" && !p.data["adjustment"]);
    if (paid)
      return fail(
        `${String(paid.data["trainerNameSnapshot"] ?? "The trainer")} was already paid the PT share from this bill here. Mark that payout back to pending first (Income & expenses).`,
      );
    out.cancelPayouts = payouts
      .filter((p) => p.data["status"] === "pending" && !p.data["adjustment"])
      .map((p) => p.id);
  }
  return out;
}

async function readBillParts(billId: string) {
  const [pays, payouts] = await Promise.all([
    getDocs(query(col(COLLECTIONS.payments), where("invoiceId", "==", billId))),
    getDocs(query(col(COLLECTIONS.trainerPayouts), where("invoiceId", "==", billId))),
  ]);
  return {
    payments: pays.docs.map((d) => ({ id: d.id, data: d.data() })),
    payouts: payouts.docs.map((d) => ({ id: d.id, data: d.data() })),
  };
}

/** For the dialog: the bill's payments and payouts, and what the move would do. */
export async function previewOldMove(bill: Invoice | null, amount: number) {
  const parts = bill ? await readBillParts(bill.id) : { payments: [], payouts: [] };
  return planOldMove(bill, parts.payments, parts.payouts, amount);
}

export async function markPaidInOldSoftware(input: {
  membership: Membership;
  bill: Invoice | null;
  amount: number;
  billNo: string;
  reason: string;
  /** Income & expenses (owner): it changes money. */
  canFinance: boolean;
  by: { uid: string; name: string };
}) {
  const { membership: m, bill } = input;
  if (!input.canFinance)
    throw new Error("This changes money: it needs the owner's login (Income & expenses).");
  if (m.paidInOldSoftware)
    throw new Error("This plan is already marked as paid in the old software.");
  const parts = bill ? await readBillParts(bill.id) : { payments: [], payouts: [] };
  const plan = planOldMove(bill, parts.payments, parts.payouts, input.amount);
  if (bill && plan.error) throw new Error(plan.error);
  const amount = bill ? round(input.amount) : Math.max(0, round(input.amount));
  const today = todayISO();
  const reason = input.reason.trim().slice(0, 300);
  const now = serverTimestamp();
  const moveRef = doc(col(COLLECTIONS.oldSoftwareMoves));
  const planRef = doc(db, COLLECTIONS.memberships, m.id);
  const billRef = bill ? doc(db, COLLECTIONS.invoices, bill.id) : null;
  const pubRef = bill?.publicToken ? doc(db, COLLECTIONS.publicInvoices, bill.publicToken) : null;
  const ptRef = bill?.ptAssignmentId
    ? doc(db, COLLECTIONS.ptAssignments, bill.ptAssignmentId)
    : null;
  const enrRef = bill?.enrollmentId ? doc(db, COLLECTIONS.enrollments, bill.enrollmentId) : null;
  const edit: MembershipEdit = {
    on: today,
    by: input.by.name,
    reason,
    changes: [
      `Marked as paid in the old software (${formatPrice(amount)})` +
        (bill && plan.remove.length + plan.lower.length
          ? `: taken off this app's money (bill ${bill.invoiceNumber})`
          : ""),
    ],
  };

  await runTransaction(db, async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists()) throw new Error("This plan no longer exists.");
    if (planSnap.data()["paidInOldSoftware"] === true)
      throw new Error("This plan is already marked as paid in the old software.");
    const read = async (r: ReturnType<typeof doc> | null) => (r ? await tx.get(r) : null);
    const [billSnap, pubSnap, ptSnap, enrSnap] = await Promise.all([
      read(billRef),
      read(pubRef),
      read(ptRef),
      read(enrRef),
    ]);
    const paySnaps = await Promise.all(
      [...plan.remove, ...plan.lower].map((p) => tx.get(doc(db, COLLECTIONS.payments, p.id))),
    );
    const payoutSnaps = await Promise.all(
      plan.cancelPayouts.map((id) => tx.get(doc(db, COLLECTIONS.trainerPayouts, id))),
    );
    if (bill && billSnap) {
      const b = billSnap.data() ?? {};
      if (
        Number(b["amountPaid"] ?? 0) !== bill.amountPaid ||
        Number(b["total"] ?? 0) !== bill.total
      )
        throw new Error("A payment was just added to this bill. Close and try again.");
    }
    const keep = (
      s: { exists: () => boolean; id: string; data: () => DocumentData | undefined } | null,
    ) => (s && s.exists() ? { id: s.id, data: s.data() ?? {} } : null);
    // 1. Everything as it was, for Undo.
    tx.set(moveRef, {
      membershipId: m.id,
      clientId: m.clientId,
      invoiceId: bill?.id ?? "",
      amount,
      reason,
      by: input.by.name,
      byUid: input.by.uid,
      createdAt: now,
      undone: false,
      after: plan.after,
      before: {
        membership: { id: m.id, data: planSnap.data() },
        invoice: keep(billSnap),
        publicInvoice: keep(pubSnap),
        ptAssignment: keep(ptSnap),
        enrollment: keep(enrSnap),
        payments: paySnaps.map(keep).filter(Boolean),
        payouts: payoutSnaps.map(keep).filter(Boolean),
      },
    });
    // 2. The plan.
    const prev = planSnap.data();
    tx.update(planRef, {
      paidInOldSoftware: true,
      oldSoftwarePaid: amount,
      ...(input.billNo.trim() ? { oldSoftwareBillNo: input.billNo.trim().slice(0, 40) } : {}),
      oldSoftwareMoveId: moveRef.id,
      edits: [...(Array.isArray(prev["edits"]) ? prev["edits"] : []), edit],
      updatedAt: now,
    });
    if (!bill || !billRef) return;
    // 3. The bill and its link.
    const b = billSnap?.data() ?? {};
    const money = {
      discount: plan.after.discount,
      tax: plan.after.tax,
      total: plan.after.total,
      amountPaid: plan.after.amountPaid,
      balanceDue: plan.after.balanceDue,
      oldSoftwareCredit: plan.after.credit,
      paymentStatus:
        plan.after.balanceDue <= 0 ? "paid" : plan.after.amountPaid > 0 ? "partial" : "pending",
    };
    tx.update(billRef, {
      ...money,
      paidInOldSoftware: plan.after.amountPaid <= 0,
      notes: [
        String(b["notes"] ?? ""),
        `${formatDateISO(today)}: ${formatPrice(amount)} was paid in the old software${reason ? ` (${reason})` : ""}`,
      ]
        .filter(Boolean)
        .join(" · "),
      updatedAt: now,
    });
    if (pubSnap?.exists()) tx.update(pubRef!, { ...money, updatedAt: now });
    // 4. The payments: taken off, or lowered (the rest was real money here).
    const split = {
      total: plan.after.total,
      subtotal: bill.subtotal,
      discount: money.discount,
      membershipGross: bill.membershipGross,
      ptGross: bill.ptGross,
      trainerShareTotal: bill.trainerShareTotal,
    };
    for (const p of plan.remove) tx.delete(doc(db, COLLECTIONS.payments, p.id));
    for (const p of plan.lower)
      tx.update(doc(db, COLLECTIONS.payments, p.id), {
        amount: p.to,
        ...allocatePayment(split, p.to),
        note: `${formatPrice(round(p.from - p.to))} of it was paid in the old software`,
        updatedAt: now,
      });
    // 5. Trainer shares for money that never came in here.
    for (const id of plan.cancelPayouts)
      tx.update(doc(db, COLLECTIONS.trainerPayouts, id), {
        status: "cancelled",
        cancelNote: "Paid in the old software",
        updatedAt: now,
      });
    if (plan.after.amountPaid <= 0) {
      if (ptSnap?.exists()) tx.update(ptRef!, { paidInOldSoftware: true, updatedAt: now });
      if (enrSnap?.exists()) tx.update(enrRef!, { paidInOldSoftware: true, updatedAt: now });
    }
  });
  return { moveId: moveRef.id, plan };
}

/** Undo: puts the plan, bill, link, payments and trainer shares back exactly as they were. */
export async function undoOldSoftwareMove(moveId: string, canFinance: boolean) {
  if (!canFinance)
    throw new Error("This changes money: it needs the owner's login (Income & expenses).");
  const ref = doc(db, COLLECTIONS.oldSoftwareMoves, moveId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Nothing to undo.");
  const mv = snap.data();
  if (mv["undone"]) throw new Error("Already undone.");
  const before = (mv["before"] ?? {}) as Record<string, OldMoveRow | OldMoveRow[] | null>;
  const one = (k: string) => before[k] as OldMoveRow | null;
  const many = (k: string) => (before[k] as OldMoveRow[] | undefined) ?? [];
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(ref);
    if (fresh.data()?.["undone"]) throw new Error("Already undone.");
    const inv = one("invoice");
    if (inv) {
      const now = await tx.get(doc(db, COLLECTIONS.invoices, inv.id));
      const after = mv["after"] as { amountPaid: number; total: number };
      if (
        now.exists() &&
        (Number(now.data()["amountPaid"] ?? 0) !== after.amountPaid ||
          Number(now.data()["total"] ?? 0) !== after.total)
      )
        throw new Error("The bill changed since (a payment or edit): undo that first.");
    }
    const put = (c: string, r: OldMoveRow | null) => r && tx.set(doc(db, c, r.id), r.data);
    put(COLLECTIONS.memberships, one("membership"));
    put(COLLECTIONS.invoices, inv);
    put(COLLECTIONS.publicInvoices, one("publicInvoice"));
    put(COLLECTIONS.ptAssignments, one("ptAssignment"));
    put(COLLECTIONS.enrollments, one("enrollment"));
    many("payments").forEach((r) => put(COLLECTIONS.payments, r));
    many("payouts").forEach((r) => put(COLLECTIONS.trainerPayouts, r));
    tx.update(ref, { undone: true, undoneAt: serverTimestamp() });
  });
}
