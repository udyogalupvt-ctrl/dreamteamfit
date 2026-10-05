import { doc, getDocs, query, runTransaction, serverTimestamp, where } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { billTaxRate, calculateInvoiceTotals, derivePaymentStatus } from "@/lib/invoice-utils";
import type { BusinessBillingSettings, Invoice, RecordEdit } from "@/types/models";
import { allocatePayment } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Correcting a bill: the discount (Income & expenses only: it changes money), the day the member
 * promised to pay the balance (the reminder goes out that morning) and the note. The public bill
 * link shows the same, and payments on the bill are split again by the new total.
 */

export interface BillEditForm {
  /** Discount given by staff (an upgrade credit on the bill stays as it is). */
  discount: number;
  dueDate: string;
  notes: string;
}

/** The discount staff gave, without the credit for an upgraded plan's unused days. */
export const staffDiscountOf = (i: Pick<Invoice, "discount" | "upgradeCredit">) =>
  Math.max(0, Math.round((i.discount - Math.max(0, i.upgradeCredit || 0)) * 100) / 100);

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
    f.discount + Math.max(0, i.upgradeCredit || 0),
    { taxEnabled: i.tax > 0, taxRate: billTaxRate(i) },
    i.amountPaid,
  );
  let error = "";
  if (discountChanged) {
    changes.push(`Discount ${formatPrice(before)} → ${formatPrice(f.discount)}`);
    if (!(f.discount >= 0)) error = "Enter the discount in rupees (0 for none).";
    else if (i.paymentStatus === "closed" || i.paymentStatus === "refunded")
      error = `This bill is ${i.paymentStatus}: its discount can't change.`;
    else if (totals.total < i.amountPaid)
      error = `Too big: ${formatPrice(i.amountPaid)} is already paid, so the total can't go below it.`;
  }
  const balance = discountChanged
    ? Math.round((totals.total - i.amountPaid) * 100) / 100
    : i.balanceDue;
  if (balance > 0 && f.dueDate !== i.dueDate) {
    changes.push(`Pay by ${formatDateISO(i.dueDate)} → ${formatDateISO(f.dueDate)}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) error ||= "Pick the pay-by date.";
  }
  if (f.notes.trim() !== i.notes.trim()) changes.push("Note changed");
  return { changes, error, discountChanged, totals, balance };
}

export async function editBill(input: {
  invoice: Invoice;
  form: BillEditForm;
  settings: Pick<BusinessBillingSettings, "taxRate">;
  reason: string;
  canDiscount: boolean;
  by: string;
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
    if (Number(d["amountPaid"] ?? 0) !== i.amountPaid || Number(d["total"] ?? 0) !== i.total)
      throw new Error("A payment was just added to this bill. Open it again.");
    const shared: Record<string, unknown> = {
      notes: form.notes.trim().slice(0, 500),
      ...(pv.balance > 0 ? { dueDate: form.dueDate } : {}),
      updatedAt: serverTimestamp(),
    };
    if (pv.discountChanged) {
      const t = pv.totals;
      Object.assign(shared, {
        discount: t.discount,
        tax: t.tax,
        total: t.total,
        balanceDue: t.balanceDue,
        paymentStatus: derivePaymentStatus(t.total, i.amountPaid),
      });
      const split = {
        total: t.total,
        membershipGross: i.membershipGross,
        ptGross: i.ptGross,
        trainerShareTotal: i.trainerShareTotal,
      };
      pays?.docs
        .filter((p) => Number(p.data()["amount"] ?? 0) > 0)
        .forEach((p) =>
          tx.update(p.ref, {
            ...allocatePayment(split, Number(p.data()["amount"])),
            updatedAt: serverTimestamp(),
          }),
        );
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
      const { notes: _n, ...pub } = shared;
      tx.update(doc(db, COLLECTIONS.publicInvoices, i.publicToken), pub);
    }
  });
  return pv.changes;
}
