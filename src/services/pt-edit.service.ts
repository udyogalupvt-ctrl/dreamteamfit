import { doc, getDocs, query, serverTimestamp, where, writeBatch } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, todayISO } from "@/lib/format";
import type { PtAssignment, PtAssignmentStatus, RecordEdit, Trainer } from "@/types/models";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Correcting a sold PT plan: its trainer (the share moves to the new trainer's unpaid payout) or
 * its dates. The price and the share stay as sold.
 */

export const canEditPt = (p: Pick<PtAssignment, "status">) =>
  p.status === "active" || p.status === "pending";

export const ptStatusFromDates = (start: string, end: string, today = todayISO()) =>
  (end < today ? "completed" : start <= today ? "active" : "pending") as PtAssignmentStatus;

export interface PtEditForm {
  trainer: Pick<Trainer, "id" | "name">;
  startDate: string;
  endDate: string;
}

export function ptChanges(p: PtAssignment, f: PtEditForm) {
  const out: string[] = [];
  if (f.trainer.id !== p.trainerId)
    out.push(`Trainer ${p.trainerNameSnapshot} → ${f.trainer.name}`);
  if (f.startDate !== p.startDate)
    out.push(`Start ${formatDateISO(p.startDate)} → ${formatDateISO(f.startDate)}`);
  if (f.endDate !== p.endDate)
    out.push(`End ${formatDateISO(p.endDate)} → ${formatDateISO(f.endDate)}`);
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
  const changes = ptChanges(p, form);
  if (!changes.length) throw new Error("Nothing was changed.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate))
    throw new Error("Pick the start and end dates.");
  if (form.endDate < form.startDate) throw new Error("The end date is before the start date.");
  const trainerChanged = form.trainer.id !== p.trainerId;
  if (trainerChanged && !input.canFinance)
    throw new Error("Changing the trainer moves their share: it needs Income & expenses.");

  const batch = writeBatch(db);
  const now = serverTimestamp();
  if (trainerChanged) {
    const payouts = await getDocs(
      query(col(COLLECTIONS.trainerPayouts), where("ptAssignmentId", "==", p.id)),
    );
    const paid = payouts.docs.find((d) => d.data()["status"] === "paid" && !d.data()["adjustment"]);
    if (paid)
      throw new Error(
        `${p.trainerNameSnapshot} was already paid this share. Mark that payout back to pending first (Income & expenses).`,
      );
    payouts.docs
      .filter((d) => d.data()["status"] !== "cancelled" && !d.data()["adjustment"])
      .forEach((d) =>
        batch.update(d.ref, {
          trainerId: form.trainer.id,
          trainerNameSnapshot: form.trainer.name,
          updatedAt: now,
        }),
      );
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
    edits: [...p.edits, edit],
    updatedAt: now,
  });
  await batch.commit();
  return changes;
}
