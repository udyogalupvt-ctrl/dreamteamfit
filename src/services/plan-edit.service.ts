import { doc, getDocs, query, runTransaction, serverTimestamp, where } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { addDaysISO, formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { billTaxRate, calculateInvoiceTotals, derivePaymentStatus } from "@/lib/invoice-utils";
import type {
  BusinessBillingSettings,
  Client,
  GymPackage,
  Invoice,
  InvoiceItem,
  Membership,
  MembershipEdit,
  MembershipStatus,
  PaymentMethod,
} from "@/types/models";
import { staffDiscountOf } from "./bill-edit.service";
import { allocatePayment } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Correcting a plan after it was sold: wrong package, wrong start / end date, wrong counsellor,
 * a discount that was forgotten (or typed wrong) when the plan was sold.
 *
 * The same plan is changed (no second sale): its bill is re-priced when the package price changes
 * (balance asked for, or the extra money given back as a refund), the payments on that bill are
 * re-split between membership and PT, the member's plan summary follows the dates, and the door
 * is re-checked (every plan write does that). Each correction is listed on the plan.
 */

/** A plan that can still be corrected: running or waiting to start, not ended by an upgrade. */
export const canEditPlan = (m: Pick<Membership, "status" | "upgradedTo">) =>
  ["active", "pending", "biometric_pending"].includes(m.status) && !m.upgradedTo;

/** Days added by pauses (they moved the end date forward). */
export const pausedDays = (m: Pick<Membership, "pauses">) =>
  m.pauses.reduce((n, p) => n + (Number(p.days) || 0), 0);

/** End date for a start and a package: its days, plus the days the plan was paused. */
export const standardEnd = (startDate: string, durationDays: number, paused: number) =>
  addDaysISO(startDate, durationDays + paused);

/** Plan status from its dates (same rule as the nightly job). */
export const statusFromDates = (start: string, end: string, today = todayISO()) =>
  (end < today ? "expired" : start <= today ? "active" : "pending") as MembershipStatus;

/** The bill a plan was sold on (its id on the plan, or the bill that names the plan). */
export const billOfPlan = (m: Pick<Membership, "id" | "invoiceId">, invoices: Invoice[]) =>
  invoices.find((i) => (m.invoiceId && i.id === m.invoiceId) || i.membershipId === m.id) ?? null;

export interface PlanEditForm {
  pkg: Pick<GymPackage, "id" | "name" | "price" | "durationDays">;
  startDate: string;
  endDate: string;
  counsellor: { id: string; name: string } | null;
  /**
   * The discount on the plan's bill (₹, not counting an upgrade's credit). Left out = unchanged.
   * Lower total than what was paid = the extra is given back as a refund.
   */
  discount?: number | undefined;
}

export interface BillChange {
  bill: Invoice;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Paid on the bill after the change (what was paid, less any refund). */
  amountPaid: number;
  balanceDue: number;
  /** Paid more than the new total: given back. */
  refund: number;
  /** Balance that is new or bigger than before: needs a pay-by date. */
  newBalance: boolean;
}

export interface PlanEditPreview {
  /** One plain line per field that changes (empty = nothing to save). */
  changes: string[];
  error: string;
  /** Bill re-priced because the package price changed; null = the bill stays as it is. */
  bill: BillChange | null;
  /** Why the bill is not changed although the price did (old software, no bill…). */
  billNote: string;
  /** The discount is changed (needs Income & expenses, like Edit bill). */
  discountChanged: boolean;
  /** The counsellor is changed: their bill and payments follow (incentives count from those). */
  counsellorChanged: boolean;
  status: MembershipStatus;
}

/**
 * What saving would do. Shared by the dialog (shown before saving) and the save itself, so the
 * member sees exactly what is written.
 */
export function previewPlanEdit(
  m: Membership,
  form: PlanEditForm,
  bill: Invoice | null,
  settings: Pick<BusinessBillingSettings, "taxRate">,
  today = todayISO(),
): PlanEditPreview {
  const changes: string[] = [];
  const pkgChanged = form.pkg.id !== m.packageId || form.pkg.name !== m.packageNameSnapshot;
  const priceChanged = form.pkg.price !== m.priceSnapshot;
  if (pkgChanged)
    changes.push(
      `Package ${m.packageNameSnapshot} → ${form.pkg.name}` +
        (priceChanged ? ` (${formatPrice(m.priceSnapshot)} → ${formatPrice(form.pkg.price)})` : ""),
    );
  else if (priceChanged)
    changes.push(`Price ${formatPrice(m.priceSnapshot)} → ${formatPrice(form.pkg.price)}`);
  if (form.startDate !== m.startDate)
    changes.push(`Start ${formatDateISO(m.startDate)} → ${formatDateISO(form.startDate)}`);
  if (form.endDate !== m.endDate)
    changes.push(`End ${formatDateISO(m.endDate)} → ${formatDateISO(form.endDate)}`);
  const counsellorId = form.counsellor?.id ?? "";
  const counsellorChanged = counsellorId !== m.counsellorId;
  if (counsellorChanged)
    changes.push(`Counsellor ${m.counsellorName || "none"} → ${form.counsellor?.name || "none"}`);
  const oldDiscount = bill ? staffDiscountOf(bill) : 0;
  const newDiscount =
    form.discount === undefined || !Number.isFinite(form.discount)
      ? oldDiscount
      : Math.round(form.discount * 100) / 100;
  const discountChanged = !!bill && newDiscount !== oldDiscount;
  if (discountChanged)
    changes.push(`Discount ${formatPrice(oldDiscount)} → ${formatPrice(newDiscount)}`);

  const status =
    m.status === "biometric_pending"
      ? m.status
      : statusFromDates(form.startDate, form.endDate, today);
  let error = "";
  if (!canEditPlan(m))
    error = m.upgradedTo
      ? "This plan was upgraded: change the new plan instead."
      : "Only a running or upcoming plan can be changed.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate))
    error = "Pick the start and end dates.";
  else if (form.endDate < form.startDate) error = "The end date is before the start date.";
  else if (form.startDate !== m.startDate && (bill?.upgradeCredit ?? 0) > 0)
    error =
      "This plan is an upgrade: its start date stays (the old plan ends the day before it). Change the end date instead.";
  else if (newDiscount < 0) error = "The discount can't be below ₹0.";

  let billChange: BillChange | null = null;
  let billNote = "";
  if (priceChanged || pkgChanged || discountChanged) {
    if (m.paidInOldSoftware) billNote = "Paid in the old software: no bill here is changed.";
    else if (!bill) billNote = "No bill is linked to this plan, so no bill is changed.";
    else if (bill.paymentStatus === "closed" || bill.paymentStatus === "refunded")
      billNote = `Bill ${bill.invoiceNumber} is ${bill.paymentStatus}: it is not changed.`;
    else {
      // The plan's line on the bill: the one for its package, else the gym membership line.
      let at = bill.items.findIndex((i) => !!i.packageId && i.packageId === m.packageId);
      if (at < 0) at = bill.items.findIndex((i) => i.description.startsWith("Gym membership"));
      // Only the discount changes: the lines stay as they are.
      if (at < 0 && (priceChanged || pkgChanged))
        billNote = `Bill ${bill.invoiceNumber} has no line for this plan: it is not changed.`;
      else {
        const items = bill.items.map((it, i) =>
          i === at && (priceChanged || pkgChanged)
            ? {
                name: form.pkg.name,
                description: `Gym membership · ${form.pkg.durationDays} days`,
                quantity: 1,
                unitPrice: form.pkg.price,
                total: form.pkg.price,
                packageId: form.pkg.id,
              }
            : it,
        );
        // The bill's own tax; the upgrade credit stays, the discount is the one asked for.
        const subtotal = items.reduce((n, i) => n + i.quantity * i.unitPrice, 0);
        const credit = bill.upgradeCredit ?? 0;
        if (discountChanged && newDiscount + credit > subtotal)
          error = `The discount can't be more than the bill (${formatPrice(Math.max(0, subtotal - credit))}).`;
        const totals = calculateInvoiceTotals(
          items,
          newDiscount + credit,
          // The bill's own tax rate (not today's setting, which may have changed or not loaded).
          { taxEnabled: bill.tax > 0, taxRate: billTaxRate(bill) },
          bill.amountPaid,
        );
        const refund = Math.max(0, Math.round((bill.amountPaid - totals.total) * 100) / 100);
        billChange = {
          bill,
          items,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          amountPaid: totals.amountPaid,
          balanceDue: totals.balanceDue,
          refund,
          newBalance: totals.balanceDue > bill.balanceDue,
        };
      }
    }
  }
  if (discountChanged && !billChange && !error)
    error = billNote || "This plan's bill can't be changed here.";
  return {
    changes,
    error,
    bill: billChange,
    billNote,
    status,
    discountChanged,
    counsellorChanged,
  };
}

export interface PlanEditInput {
  client: Pick<Client, "id" | "fullName" | "currentMembership">;
  membership: Membership;
  form: PlanEditForm;
  bill: Invoice | null;
  settings: Pick<BusinessBillingSettings, "taxRate">;
  reason: string;
  /** How the extra money is given back when the new price is lower than what was paid. */
  refundMethod: PaymentMethod;
  /** May give money back and change a discount (Income & expenses). */
  canRefund: boolean;
  /** When a new / bigger balance is left: the day the member will pay it. */
  nextPaymentDate: string | null;
  by: { uid: string; name: string };
}

export async function editMembership(input: PlanEditInput) {
  const { membership: m, form, client } = input;
  const today = todayISO();
  const preview = previewPlanEdit(m, form, input.bill, input.settings, today);
  if (preview.error) throw new Error(preview.error);
  if (!preview.changes.length) throw new Error("Nothing was changed.");
  const bc = preview.bill;
  if (preview.discountChanged && !input.canRefund)
    throw new Error("Changing a discount needs the owner's login (Income & expenses).");
  if (bc && bc.refund > 0 && !input.canRefund)
    throw new Error(
      `They paid ${formatPrice(bc.refund)} more than the new price. Giving money back needs the owner (Income & expenses).`,
    );
  if (bc && bc.newBalance && !input.nextPaymentDate)
    throw new Error("Pick the date the member will pay the balance.");

  // The counsellor follows onto the plan's bill and its payments (incentives count from those).
  const counsellorBill = preview.counsellorChanged && !m.paidInOldSoftware ? input.bill : null;
  const billForPays = bc?.bill ?? counsellorBill;
  // Read first (a transaction can't query): the member's other plans and the bill's payments.
  const [plansSnap, paysSnap] = await Promise.all([
    getDocs(query(col(COLLECTIONS.memberships), where("clientId", "==", client.id))),
    billForPays
      ? getDocs(query(col(COLLECTIONS.payments), where("invoiceId", "==", billForPays.id)))
      : Promise.resolve(null),
  ]);
  const counsellorFields = {
    counsellorId: form.counsellor?.id ?? "",
    counsellorName: form.counsellor?.name ?? "",
  };

  const reason = input.reason.trim().slice(0, 300);
  const edit: MembershipEdit = { on: today, by: input.by.name, reason, changes: preview.changes };
  const now = serverTimestamp();
  const planRef = doc(db, COLLECTIONS.memberships, m.id);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(planRef);
    const billRef = bc ? doc(db, COLLECTIONS.invoices, bc.bill.id) : null;
    const freshBill = billRef ? await tx.get(billRef) : null;
    if (!fresh.exists()) throw new Error("This plan no longer exists.");
    const f = fresh.data();
    // Someone else changed it meanwhile: start again from what is there now.
    if (
      f["status"] !== m.status ||
      f["endDate"] !== m.endDate ||
      f["startDate"] !== m.startDate ||
      (f["packageId"] ?? "") !== m.packageId ||
      Number(f["priceSnapshot"] ?? 0) !== m.priceSnapshot
    )
      throw new Error("This plan was just changed by someone else. Close and open Edit again.");
    if (
      freshBill &&
      bc &&
      (Number(freshBill.data()?.["amountPaid"] ?? 0) !== bc.bill.amountPaid ||
        Number(freshBill.data()?.["total"] ?? 0) !== bc.bill.total ||
        Number(freshBill.data()?.["discount"] ?? 0) !== bc.bill.discount)
    )
      throw new Error("A payment was just added to this bill. Close and open Edit again.");

    tx.update(planRef, {
      packageId: form.pkg.id,
      packageNameSnapshot: form.pkg.name,
      priceSnapshot: form.pkg.price,
      durationDaysSnapshot: form.pkg.durationDays,
      startDate: form.startDate,
      endDate: form.endDate,
      status: preview.status,
      counsellorId: form.counsellor?.id ?? "",
      counsellorName: form.counsellor?.name ?? "",
      edits: [...(Array.isArray(f["edits"]) ? f["edits"] : []), edit],
      updatedAt: now,
    });

    if (bc && billRef) {
      const paymentStatus = derivePaymentStatus(bc.total, bc.amountPaid);
      const dueDate = bc.balanceDue > 0 ? (input.nextPaymentDate ?? bc.bill.dueDate) : today;
      const what =
        form.pkg.id !== m.packageId || form.pkg.price !== m.priceSnapshot
          ? `plan changed to ${form.pkg.name}`
          : `discount changed to ${formatPrice(bc.discount - (bc.bill.upgradeCredit ?? 0))}`;
      const note = `${formatDateISO(today)}: ${what}${reason ? ` (${reason})` : ""}`;
      const money = {
        items: bc.items,
        subtotal: bc.subtotal,
        discount: bc.discount,
        tax: bc.tax,
        total: bc.total,
        amountPaid: bc.amountPaid,
        balanceDue: bc.balanceDue,
        paymentStatus,
        dueDate,
      };
      const breakdown = {
        // Only the discount changed: the plan's share of the bill stays as it was.
        membershipGross:
          form.pkg.id !== m.packageId || form.pkg.price !== m.priceSnapshot
            ? form.pkg.price
            : bc.bill.membershipGross || form.pkg.price,
        ptGross: bc.bill.ptGross,
        trainerShareTotal: bc.bill.trainerShareTotal,
      };
      tx.update(billRef, {
        ...money,
        ...breakdown,
        ...(preview.counsellorChanged ? counsellorFields : {}),
        packageId: form.pkg.id,
        notes: [bc.bill.notes, note].filter(Boolean).join(" · "),
        updatedAt: now,
      });
      if (bc.bill.publicToken)
        tx.update(doc(db, COLLECTIONS.publicInvoices, bc.bill.publicToken), {
          ...money,
          updatedAt: now,
        });
      if (bc.bill.enrollmentId)
        tx.update(doc(db, COLLECTIONS.enrollments, bc.bill.enrollmentId), {
          paymentStatus,
          updatedAt: now,
        });
      // Money already taken on this bill: re-split between membership, PT and trainer by the new
      // prices, so reports count the right income.
      const split = {
        total: bc.total,
        subtotal: bc.subtotal,
        discount: bc.discount,
        ...breakdown,
      };
      paysSnap?.docs
        .filter((p) => Number(p.data()["amount"] ?? 0) > 0)
        .forEach((p) =>
          tx.update(p.ref, {
            ...allocatePayment(split, Number(p.data()["amount"])),
            ...(preview.counsellorChanged ? counsellorFields : {}),
            updatedAt: now,
          }),
        );
      if (bc.refund > 0)
        tx.set(doc(col(COLLECTIONS.payments)), {
          clientId: client.id,
          clientNameSnapshot: client.fullName,
          invoiceId: bc.bill.id,
          invoiceNumber: bc.bill.invoiceNumber,
          membershipId: m.id,
          ptAssignmentId: null,
          amount: -bc.refund,
          method: input.refundMethod,
          paymentDate: today,
          kind: "refund",
          note: `${preview.discountChanged && form.pkg.price === m.priceSnapshot ? "Discount given" : `Plan changed to ${form.pkg.name}`}${reason ? `: ${reason}` : ""}`,
          // Split like the bill's payments, so payments + refund = the new bill's split.
          ...allocatePayment(split, -bc.refund),
          createdBy: input.by.name,
          createdByUid: input.by.uid,
          counsellorId: "",
          counsellorName: "",
          createdAt: now,
          updatedAt: now,
        });
    }

    // Only the counsellor changed: the bill, its payments and the joining record follow.
    if (!bc && counsellorBill && preview.counsellorChanged) {
      tx.update(doc(db, COLLECTIONS.invoices, counsellorBill.id), {
        ...counsellorFields,
        updatedAt: now,
      });
      paysSnap?.docs
        .filter((p) => Number(p.data()["amount"] ?? 0) > 0)
        .forEach((p) => tx.update(p.ref, { ...counsellorFields, updatedAt: now }));
    }
    const enrollmentId = (bc?.bill ?? counsellorBill)?.enrollmentId;
    if (preview.counsellorChanged && enrollmentId)
      tx.update(doc(db, COLLECTIONS.enrollments, enrollmentId), {
        ...counsellorFields,
        updatedAt: now,
      });

    // The member's plan summary: the plan running today (latest start), with the new dates.
    const plans = plansSnap.docs
      .map((d) => ({ id: d.id, d: d.data() }))
      .filter(({ d }) => ["active", "pending", "biometric_pending"].includes(String(d["status"])))
      .map(({ id, d }) =>
        id === m.id
          ? {
              id,
              name: form.pkg.name,
              start: form.startDate,
              end: form.endDate,
            }
          : {
              id,
              name: String(d["packageNameSnapshot"] ?? ""),
              start: String(d["startDate"] ?? ""),
              end: String(d["endDate"] ?? ""),
            },
      );
    const running = plans
      .filter((p) => p.start <= today && p.end >= today)
      .sort((a, b) => b.start.localeCompare(a.start))[0];
    const clientRef = doc(db, COLLECTIONS.clients, client.id);
    if (running)
      tx.update(clientRef, {
        currentMembership: {
          membershipId: running.id,
          packageName: running.name,
          startDate: running.start,
          endDate: running.end,
          status: "active",
        },
        status: "active",
        updatedAt: now,
      });
    else if (client.currentMembership?.membershipId === m.id)
      tx.update(clientRef, {
        currentMembership: {
          membershipId: m.id,
          packageName: form.pkg.name,
          startDate: form.startDate,
          endDate: form.endDate,
          status: preview.status,
        },
        updatedAt: now,
      });
  });
  return preview;
}
