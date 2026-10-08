import { doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import type {
  PtAssignment,
  PtAssignmentStatus,
  RecordEdit,
  ShareType,
  Trainer,
} from "@/types/models";
import { allocatePayment } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";
import { calculateShare } from "./pt.service";

/**
 * Correcting a sold PT plan: its trainer (the share moves to the new trainer's unpaid payout),
 * its dates, or the trainer's share (% or ₹) when it was typed wrong. The PT price stays as sold
 * (a lower price is a discount: Edit bill).
 */

/** Running or upcoming; a PT plan paid in the old software can be corrected after it ended too. */
export const canEditPt = (p: Pick<PtAssignment, "status" | "paidInOldSoftware">) =>
  p.status === "active" ||
  p.status === "pending" ||
  (p.paidInOldSoftware === true && p.status === "completed");

export const ptStatusFromDates = (start: string, end: string, today = todayISO()) =>
  (end < today ? "completed" : start <= today ? "active" : "pending") as PtAssignmentStatus;

export interface PtEditForm {
  trainer: Pick<Trainer, "id" | "name">;
  startDate: string;
  endDate: string;
  /** The trainer's share; left out = unchanged. */
  share?: { type: ShareType; value: number } | undefined;
  /** Plan paid in the old software: what was paid there (₹). Left out = unchanged. */
  oldPaid?: number | undefined;
}

/** The amount paid in the old software after saving (unchanged when not given). */
export const newOldPaidOf = (p: PtAssignment, f: PtEditForm) =>
  !p.paidInOldSoftware || f.oldPaid === undefined || !Number.isFinite(f.oldPaid)
    ? (p.oldSoftwarePaid ?? 0)
    : Math.round(f.oldPaid);

const shareLabel = (type: ShareType, value: number, amount: number) =>
  type === "percentage" ? `${value}% (${formatPrice(amount)})` : formatPrice(amount);

/** The new share when it changes, else null. */
export function newShareOf(p: PtAssignment, f: PtEditForm) {
  if (!f.share || !Number.isFinite(f.share.value)) return null;
  const s = calculateShare(p.ptPrice, f.share.type, f.share.value);
  return s.trainerShareType === p.trainerShareType &&
    s.trainerShareValue === p.trainerShareValue &&
    s.trainerShareAmount === p.trainerShareAmount
    ? null
    : s;
}

export function ptChanges(p: PtAssignment, f: PtEditForm) {
  const out: string[] = [];
  if (f.trainer.id !== p.trainerId)
    out.push(`Trainer ${p.trainerNameSnapshot} → ${f.trainer.name}`);
  if (f.startDate !== p.startDate)
    out.push(`Start ${formatDateISO(p.startDate)} → ${formatDateISO(f.startDate)}`);
  if (f.endDate !== p.endDate)
    out.push(`End ${formatDateISO(p.endDate)} → ${formatDateISO(f.endDate)}`);
  const s = newShareOf(p, f);
  if (s)
    out.push(
      `Trainer share ${shareLabel(p.trainerShareType, p.trainerShareValue, p.trainerShareAmount)} → ${shareLabel(s.trainerShareType, s.trainerShareValue, s.trainerShareAmount)}`,
    );
  const oldPaid = newOldPaidOf(p, f);
  if (oldPaid !== (p.oldSoftwarePaid ?? 0))
    out.push(
      `Paid in the old software ${formatPrice(p.oldSoftwarePaid ?? 0)} → ${formatPrice(oldPaid)}`,
    );
  return out;
}

export async function editPtPlan(input: {
  pt: PtAssignment;
  form: PtEditForm;
  reason: string;
  /** Moving the trainer's share needs Income & expenses. */
  canFinance: boolean;
  by: string;
}) {
  const { pt: p, form } = input;
  if (!canEditPt(p)) throw new Error("Only a running or upcoming PT plan can be changed.");
  const oldPaid = newOldPaidOf(p, form);
  if (oldPaid < 0) throw new Error("The amount paid in the old software can't be below ₹0.");
  const changes = ptChanges(p, form);
  if (!changes.length) throw new Error("Nothing was changed.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate))
    throw new Error("Pick the start and end dates.");
  if (form.endDate < form.startDate) throw new Error("The end date is before the start date.");
  const trainerChanged = form.trainer.id !== p.trainerId;
  if (trainerChanged && !input.canFinance)
    throw new Error("Changing the trainer moves their share: it needs Income & expenses.");
  const share = newShareOf(p, form);
  if (share && !input.canFinance)
    throw new Error("Changing the trainer's share needs Income & expenses (the owner).");

  const batch = writeBatch(db);
  const now = serverTimestamp();
  if (trainerChanged || share) {
    const payouts = await getDocs(
      query(col(COLLECTIONS.trainerPayouts), where("ptAssignmentId", "==", p.id)),
    );
    const paid = payouts.docs.find((d) => d.data()["status"] === "paid" && !d.data()["adjustment"]);
    if (paid)
      throw new Error(
        `${p.trainerNameSnapshot} was already paid this share. Mark that payout back to pending first (Income & expenses).`,
      );
    if (share && payouts.docs.some((d) => d.data()["adjustment"]))
      throw new Error(
        "This plan's share was already cut by a cancellation: correct it on Income & expenses → trainer pay.",
      );
    payouts.docs
      .filter((d) => d.data()["status"] !== "cancelled" && !d.data()["adjustment"])
      .forEach((d) =>
        batch.update(d.ref, {
          trainerId: form.trainer.id,
          trainerNameSnapshot: form.trainer.name,
          ...(share
            ? {
                trainerShareAmount: share.trainerShareAmount,
                gymShareAmount: share.gymShareAmount,
              }
            : {}),
          updatedAt: now,
        }),
      );
  }
  // The bill counts the trainer's share apart from gym income: it and the payments' split follow.
  if (share && p.invoiceId) {
    const billRef = doc(db, COLLECTIONS.invoices, p.invoiceId);
    const [bill, pays] = await Promise.all([
      getDoc(billRef),
      getDocs(query(col(COLLECTIONS.payments), where("invoiceId", "==", p.invoiceId))),
    ]);
    if (bill.exists()) {
      const b = bill.data();
      const trainerShareTotal = Math.max(
        0,
        Math.round(
          (Number(b["trainerShareTotal"] ?? 0) + share.trainerShareAmount - p.trainerShareAmount) *
            100,
        ) / 100,
      );
      const split = {
        total: Number(b["total"] ?? 0),
        membershipGross: Number(b["membershipGross"] ?? 0),
        ptGross: Number(b["ptGross"] ?? 0),
        trainerShareTotal,
        subtotal: Number(b["subtotal"] ?? 0),
        discount: Number(b["discount"] ?? 0),
      };
      batch.update(billRef, { trainerShareTotal, updatedAt: now });
      pays.docs
        .filter((x) => Number(x.data()["amount"] ?? 0) !== 0)
        .forEach((x) =>
          batch.update(x.ref, {
            ...allocatePayment(split, Number(x.data()["amount"])),
            updatedAt: now,
          }),
        );
    }
  }
  const edit: RecordEdit = {
    on: todayISO(),
    by: input.by,
    reason: input.reason.trim().slice(0, 300),
    changes,
  };
  batch.update(doc(db, COLLECTIONS.ptAssignments, p.id), {
    trainerId: form.trainer.id,
    trainerNameSnapshot: form.trainer.name,
    startDate: form.startDate,
    endDate: form.endDate,
    status: ptStatusFromDates(form.startDate, form.endDate),
    ...(oldPaid !== (p.oldSoftwarePaid ?? 0) ? { oldSoftwarePaid: oldPaid } : {}),
    ...(share
      ? {
          trainerShareType: share.trainerShareType,
          trainerShareValue: share.trainerShareValue,
          trainerShareAmount: share.trainerShareAmount,
          gymShareAmount: share.gymShareAmount,
        }
      : {}),
    edits: [...p.edits, edit],
    updatedAt: now,
  });
  await batch.commit();
  return changes;
}
