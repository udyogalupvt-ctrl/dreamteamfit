import { doc, getDocs, query, runTransaction, serverTimestamp, where } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  billCredits,
  billTaxRate,
  calculateInvoiceTotals,
  derivePaymentStatus,
} from "@/lib/invoice-utils";
import type { BusinessBillingSettings, Invoice, PaymentMethod, RecordEdit } from "@/types/models";
import { isOldBalanceBill } from "@/lib/old-money";
import { allocatePayment } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Correcting a bill: the discount (Income & expenses only: it changes money), the day the member
 * promised to pay the balance (the reminder goes out that morning) and the note. The public bill
 * link shows the same, and payments on the bill are split again by the new total. A discount
 * given after the full price was paid gives the extra back (a refund payment, in the Day Book).
 */

export interface BillEditForm {
  /** Discount given by staff (an upgrade credit on the bill stays as it is). */
  discount: number;
  dueDate: string;
  notes: string;
  /** Old-software balance bill only: send the daily WhatsApp balance reminders. */
  remindOldBalance?: boolean;
}

/** The discount staff gave, without credits (upgraded plan's unused days, old software money). */
export const staffDiscountOf = (
  i: Pick<Invoice, "discount" | "upgradeCredit"> & { oldSoftwareCredit?: number | undefined },
) => Math.max(0, Math.round((i.discount - billCredits(i)) * 100) / 100);

export function previewBillEdit(
  i: Invoice,
  f: BillEditForm,
  settings: Pick<BusinessBillingSettings, "taxRate">,
) {
  const changes: string[] = [];
  const before = staffDiscountOf(i);
  const discountChanged = Math.round(f.discount * 100) !== Math.round(before * 100);
  const totals = calculateInvoiceTotals(
    i.items,
    f.discount + billCredits(i),
    { taxEnabled: i.tax > 0, taxRate: billTaxRate(i) },
    i.amountPaid,
  );
  let error = "";
  if (discountChanged) {
    changes.push(`Discount ${formatPrice(before)} → ${formatPrice(f.discount)}`);
    if (!(f.discount >= 0)) error = "Enter the discount in rupees (0 for none).";
    else if (i.paymentStatus === "closed" || i.paymentStatus === "refunded")
      error = `This bill is ${i.paymentStatus}: its discount can't change.`;
  }
  /** Paid more than the new total: given back. */
  const refund =
    discountChanged && !error
      ? Math.max(0, Math.round((i.amountPaid - totals.total) * 100) / 100)
      : 0;
  const balance = discountChanged
    ? Math.round((totals.total - i.amountPaid) * 100) / 100
    : i.balanceDue;
  if (balance > 0 && f.dueDate !== i.dueDate) {
    changes.push(`Pay by ${formatDateISO(i.dueDate)} → ${formatDateISO(f.dueDate)}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) error ||= "Pick the pay-by date.";
  }
  if (f.notes.trim() !== i.notes.trim()) changes.push("Note changed");
  const remindChanged =
    isOldBalanceBill(i) &&
    f.remindOldBalance !== undefined &&
    f.remindOldBalance !== (i.remindOldBalance === true);
  if (remindChanged)
    changes.push(
      f.remindOldBalance ? "WhatsApp balance reminders: on" : "WhatsApp balance reminders: off",
    );
  return { changes, error, discountChanged, totals, balance: Math.max(0, balance), refund };
}

export async function editBill(input: {
  invoice: Invoice;
  form: BillEditForm;
  settings: Pick<BusinessBillingSettings, "taxRate">;
  reason: string;
  canDiscount: boolean;
  by: string;
  byUid?: string;
  /** How the extra is given back when the member already paid more than the new total. */
  refundMethod?: PaymentMethod;
}) {
  const { invoice: i, form } = input;
  const pv = previewBillEdit(i, form, input.settings);
  if (pv.error) throw new Error(pv.error);
  if (!pv.changes.length) throw new Error("Nothing was changed.");
  if (pv.discountChanged && !input.canDiscount)
    throw new Error("Changing a discount needs Income & expenses (the owner).");
  const pays = pv.discountChanged
    ? await getDocs(query(col(COLLECTIONS.payments), where("invoiceId", "==", i.id)))
    : null;
  const edit: RecordEdit = {
    on: todayISO(),
    by: input.by,
    reason: input.reason.trim().slice(0, 300),
    changes: pv.changes,
  };
  const ref = doc(db, COLLECTIONS.invoices, i.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This bill was removed.");
    const d = snap.data();
    if (
      Number(d["amountPaid"] ?? 0) !== i.amountPaid ||
      Number(d["total"] ?? 0) !== i.total ||
      Number(d["discount"] ?? 0) !== i.discount
    )
      throw new Error("A payment was just added to this bill. Open it again.");
    const shared: Record<string, unknown> = {
      notes: form.notes.trim().slice(0, 500),
      ...(pv.balance > 0 ? { dueDate: form.dueDate } : {}),
      ...(isOldBalanceBill(i) && form.remindOldBalance !== undefined
        ? { remindOldBalance: form.remindOldBalance }
        : {}),
      updatedAt: serverTimestamp(),
    };
    if (pv.discountChanged) {
      const t = pv.totals;
      Object.assign(shared, {
        discount: t.discount,
        tax: t.tax,
        total: t.total,
        balanceDue: t.balanceDue,
        // A refund leaves exactly the new total paid.
        amountPaid: t.amountPaid,
        paymentStatus: derivePaymentStatus(t.total, t.amountPaid),
      });
      const split = {
        total: t.total,
        membershipGross: i.membershipGross,
        ptGross: i.ptGross,
        trainerShareTotal: i.trainerShareTotal,
        subtotal: t.subtotal,
        discount: t.discount,
      };
      pays?.docs
        .filter((p) => Number(p.data()["amount"] ?? 0) > 0)
        .forEach((p) =>
          tx.update(p.ref, {
            ...allocatePayment(split, Number(p.data()["amount"])),
            updatedAt: serverTimestamp(),
          }),
        );
      if (pv.refund > 0)
        tx.set(doc(col(COLLECTIONS.payments)), {
          clientId: i.clientId,
          clientNameSnapshot: i.clientNameSnapshot,
          invoiceId: i.id,
          invoiceNumber: i.invoiceNumber,
          membershipId: i.membershipId || null,
          ptAssignmentId: i.ptAssignmentId || null,
          amount: -pv.refund,
          method: input.refundMethod ?? "Cash",
          paymentDate: todayISO(),
          kind: "refund",
          note: `Discount given${edit.reason ? `: ${edit.reason}` : ""}`,
          // Split like the bill's payments, so payments + refund = the new bill's split.
          ...allocatePayment(split, -pv.refund),
          createdBy: input.by,
          createdByUid: input.byUid ?? "",
          counsellorId: "",
          counsellorName: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      if (i.enrollmentId)
        tx.update(doc(db, COLLECTIONS.enrollments, i.enrollmentId), {
          paymentStatus: shared["paymentStatus"],
          updatedAt: serverTimestamp(),
        });
    }
    tx.update(ref, {
      ...shared,
      edits: [...(Array.isArray(d["edits"]) ? d["edits"] : []), edit],
    });
    if (i.publicToken) {
      // The reminder switch is for staff only: not on the member's bill link.
      const { notes: _n, remindOldBalance: _r, ...pub } = shared;
      tx.update(doc(db, COLLECTIONS.publicInvoices, i.publicToken), pub);
    }
  });
  return pv.changes;
}
