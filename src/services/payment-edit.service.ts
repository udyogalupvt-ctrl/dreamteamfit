import { format } from "date-fns";
import {
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { derivePaymentStatus } from "@/lib/invoice-utils";
import type { Payment, PaymentMethod, RecordEdit } from "@/types/models";
import { allocatePayment, cashOpenFrom } from "./finance.service";

export { cashOpenFrom };
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Correcting a payment after it was saved: wrong mode (Cash / UPI…), wrong amount, wrong date, or
 * a note. The bill's paid / balance follow the new amount, the membership / PT / trainer split is
 * worked out again, and the Day Book shows the corrected line.
 *
 * Who: the front desk (Billing) fixes today's payments (and ones typed in today for a plan that
 * had started, which count on its first day); older ones need Income & expenses, since they change
 * cash already counted and handed over. Payments before the 1st of last month keep
 * their amount, mode and date (the Day Book carries that cash forward); only the note changes.
 */

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** The payment was typed in today (a mistake at the desk is fixed the same day). */
const typedTodayOf = (p: Payment) =>
  p.createdAt instanceof Date &&
  !Number.isNaN(p.createdAt.getTime()) &&
  format(p.createdAt, "yyyy-MM-dd") === todayISO();

/** What this login may change on a payment. */
export function paymentEditRights(p: Payment, can: { billing: boolean; finance: boolean }) {
  const today = todayISO();
  // Paid in the old software: changed from its plan (Edit plan / Edit PT plan), not here.
  const typedToday = typedTodayOf(p);
  const mayEdit =
    !p.oldSoftware && (can.finance || (can.billing && (p.paymentDate === today || typedToday)));
  const cashOpen = p.paymentDate >= cashOpenFrom(today);
  return {
    mayEdit,
    /** Mode and date (money stays the same, moves between days / modes). */
    money: mayEdit && cashOpen,
    /** The amount: not for refunds (Restore on the plan takes those back). */
    amount: mayEdit && cashOpen && p.kind !== "refund" && !!p.invoiceId,
  };
}

/**
 * Moving a payment to another day ("Paid on"): the owner (Income & expenses) any day the Day Book
 * still has open; the front desk only a payment typed in today, the same as choosing "Paid on" at
 * the checkout. `note` says why not.
 */
export function paymentDateRights(p: Payment, can: { billing: boolean; finance: boolean }) {
  const r = paymentEditRights(p, can);
  if (p.oldSoftware)
    return {
      allowed: false,
      note: "Paid in the old software: change it in its old-software rows.",
    };
  if (!r.mayEdit)
    return { allowed: false, note: "Only the owner (Income & expenses) can change this payment." };
  if (!r.money)
    return {
      allowed: false,
      note: `Paid before ${formatDateISO(cashOpenFrom(todayISO()))}: that cash is already carried forward in the Day Book.`,
    };
  if (!can.finance && !typedTodayOf(p))
    return {
      allowed: false,
      note: "Typed in on an earlier day: only the owner (Income & expenses) can change its date.",
    };
  return { allowed: true, note: "" };
}

export interface PaymentEditForm {
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  note: string;
}

export function paymentChanges(p: Payment, f: PaymentEditForm) {
  const out: string[] = [];
  if (round(f.amount) !== round(p.amount))
    out.push(`Amount ${formatPrice(p.amount)} → ${formatPrice(f.amount)}`);
  if (f.method !== p.method) out.push(`Mode ${p.method} → ${f.method}`);
  if (f.paymentDate !== p.paymentDate)
    out.push(`Date ${formatDateISO(p.paymentDate)} → ${formatDateISO(f.paymentDate)}`);
  if (f.note.trim() !== p.note.trim())
    out.push(f.note.trim() ? `Note: ${f.note.trim()}` : "Note removed");
  return out;
}

export async function editPayment(input: {
  payment: Payment;
  form: PaymentEditForm;
  reason: string;
  can: { billing: boolean; finance: boolean };
  /** When a balance appears or grows: the day the member will pay it. */
  nextPaymentDate: string | null;
  by: string;
}) {
  const { payment: p, form } = input;
  const today = todayISO();
  const rights = paymentEditRights(p, input.can);
  if (p.oldSoftware)
    throw new Error(
      "This was paid in the old software: change it from the member's plan (Edit plan).",
    );
  if (!rights.mayEdit)
    throw new Error("Only today's payments can be changed here. Ask the owner for older ones.");
  const changes = paymentChanges(p, form);
  if (!changes.length) throw new Error("Nothing was changed.");
  const amountChanged = round(form.amount) !== round(p.amount);
  if ((form.method !== p.method || form.paymentDate !== p.paymentDate) && !rights.money)
    throw new Error("This payment is older than last month: only its note can change.");
  if (amountChanged && !rights.amount) throw new Error("The amount of this payment can't change.");
  const dateChanged = form.paymentDate !== p.paymentDate;
  const dateRights = paymentDateRights(p, input.can);
  if (dateChanged && !dateRights.allowed) throw new Error(dateRights.note);
  if (dateChanged && !/^\d{4}-\d{2}-\d{2}$/.test(form.paymentDate))
    throw new Error("Pick the payment date.");
  if (dateChanged && form.paymentDate > today)
    throw new Error("The payment date can't be in the future.");
  if (dateChanged && form.paymentDate < cashOpenFrom(today))
    throw new Error(`Pick a date from ${formatDateISO(cashOpenFrom(today))} on.`);
  if (amountChanged && !(form.amount > 0)) throw new Error("Enter an amount above zero.");

  const edit: RecordEdit = {
    on: today,
    by: input.by,
    reason: input.reason.trim().slice(0, 300),
    changes,
  };
  const payRef = doc(db, COLLECTIONS.payments, p.id);
  // The joining payment moved to another day: the trainer's unpaid share of that sale goes with it
  // (owner only: trainer payouts are Income & expenses).
  const payoutRefs: DocumentReference[] =
    dateChanged && input.can.finance && p.kind === "initial" && p.invoiceId
      ? (
          await getDocs(
            query(col(COLLECTIONS.trainerPayouts), where("invoiceId", "==", p.invoiceId)),
          )
        ).docs.map((d) => d.ref)
      : [];
  await runTransaction(db, async (tx) => {
    const pay = await tx.get(payRef);
    const invRef = p.invoiceId ? doc(db, COLLECTIONS.invoices, p.invoiceId) : null;
    const inv = invRef ? await tx.get(invRef) : null;
    const payouts = await Promise.all(payoutRefs.map((r) => tx.get(r)));
    if (!pay.exists()) throw new Error("This payment was removed.");
    const cur = pay.data();
    if (
      Number(cur["amount"]) !== p.amount ||
      cur["method"] !== p.method ||
      cur["paymentDate"] !== p.paymentDate
    )
      throw new Error("This payment was just changed by someone else. Open it again.");

    const patch: Record<string, unknown> = {
      method: form.method,
      paymentDate: form.paymentDate,
      note: form.note.trim().slice(0, 300),
      edits: [...(Array.isArray(cur["edits"]) ? cur["edits"] : []), edit],
      updatedAt: serverTimestamp(),
    };
    if (inv?.exists() && invRef) {
      const d = inv.data();
      const total = Number(d["total"] ?? 0);
      const billPatch: Record<string, unknown> = {};
      if (amountChanged) {
        const status = String(d["paymentStatus"] ?? "");
        if (status === "closed" || status === "refunded")
          throw new Error(`Bill ${d["invoiceNumber"]} is ${status}: the amount can't change.`);
        if (Number(d["cancelledDue"] ?? 0) > 0)
          throw new Error(
            `A plan on bill ${d["invoiceNumber"]} was cancelled and its unpaid part dropped: the amount can't change (Restore that plan first).`,
          );
        const before = Number(d["amountPaid"] ?? 0);
        const paid = round(before - p.amount + form.amount);
        if (paid > total + 0.001)
          throw new Error(
            `Too much: the bill is ${formatPrice(total)} and ${formatPrice(round(before - p.amount))} is paid by other payments.`,
          );
        const balance = round(total - paid);
        const oldBalance = round(total - before);
        if (balance > oldBalance && !input.nextPaymentDate)
          throw new Error("Pick the date the member will pay the balance.");
        Object.assign(billPatch, {
          amountPaid: paid,
          balanceDue: balance,
          paymentStatus: derivePaymentStatus(total, paid),
          ...(balance > oldBalance && input.nextPaymentDate
            ? { dueDate: input.nextPaymentDate }
            : {}),
        });
        Object.assign(
          patch,
          { amount: round(form.amount) },
          allocatePayment(
            {
              total,
              membershipGross: Number(d["membershipGross"] ?? 0),
              ptGross: Number(d["ptGross"] ?? 0),
              trainerShareTotal: Number(d["trainerShareTotal"] ?? 0),
              subtotal: Number(d["subtotal"] ?? 0),
              discount: Number(d["discount"] ?? 0),
            },
            round(form.amount),
          ),
        );
      }
      // The bill shows the checkout payment's mode.
      if (p.kind === "initial" && form.method !== p.method)
        billPatch["paymentMethod"] = form.method;
      if (Object.keys(billPatch).length) {
        billPatch["updatedAt"] = serverTimestamp();
        tx.update(invRef, billPatch);
        if (d["publicToken"])
          tx.update(doc(db, COLLECTIONS.publicInvoices, String(d["publicToken"])), billPatch);
        if (amountChanged && d["enrollmentId"])
          tx.update(doc(db, COLLECTIONS.enrollments, String(d["enrollmentId"])), {
            paymentStatus: billPatch["paymentStatus"],
            updatedAt: serverTimestamp(),
          });
      }
    } else if (amountChanged) throw new Error("This payment's bill was not found.");
    payouts.forEach((po) => {
      const x = po.data();
      if (po.exists() && x?.["status"] === "pending" && x["paymentDate"] === p.paymentDate)
        tx.update(po.ref, { paymentDate: form.paymentDate, updatedAt: serverTimestamp() });
    });
    tx.update(payRef, patch);
  });
  return changes;
}
