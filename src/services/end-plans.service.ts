import { doc, serverTimestamp, updateDoc, writeBatch } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type { Client, Invoice, Membership, PaymentMethod, PtAssignment } from "@/types/models";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Cancels one PT plan. The door follows at the machine's next check-in (a PT plan alone also lets
 * a member in, so this can stop their entry).
 */
export async function cancelPtAssignment(pt: PtAssignment, reason = "") {
  await updateDoc(doc(db, COLLECTIONS.ptAssignments, pt.id), {
    status: "cancelled",
    cancelledOn: todayISO(),
    cancelReason: reason.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });
}

export interface EndAllInput {
  client: Pick<Client, "id" | "fullName" | "currentMembership">;
  plans: Membership[];
  pts: PtAssignment[];
  /** The member's newest bill: the refund is noted against it. */
  latestBill: Pick<Invoice, "id" | "invoiceNumber"> | null;
  reason: string;
  /** Money given back to the member (0 = none). */
  refund: number;
  refundMethod: PaymentMethod;
  by: { uid: string; name: string };
}

/**
 * Owner's "End all plans & stop entry": every running / upcoming gym plan and PT plan is cancelled
 * in one go (the fingerprint machine then stops opening the door for them), and money given back
 * is recorded as a refund: a payment of minus that amount, so Collected, the Day Book cash and the
 * reports all go down by it.
 */
export async function endAllPlans(input: EndAllInput) {
  const refund = Math.round(Math.max(0, input.refund) * 100) / 100;
  const reason = input.reason.trim().slice(0, 300);
  const today = todayISO();
  const now = serverTimestamp();
  const batch = writeBatch(db);
  for (const m of input.plans)
    batch.update(doc(db, COLLECTIONS.memberships, m.id), {
      status: "cancelled",
      cancelledOn: today,
      cancelReason: reason,
      updatedAt: now,
    });
  for (const p of input.pts)
    batch.update(doc(db, COLLECTIONS.ptAssignments, p.id), {
      status: "cancelled",
      cancelledOn: today,
      cancelReason: reason,
      updatedAt: now,
    });
  if (input.client.currentMembership && input.plans.length)
    batch.update(doc(db, COLLECTIONS.clients, input.client.id), {
      "currentMembership.status": "cancelled",
      updatedAt: now,
    });
  if (refund > 0) {
    const onlyPt = !input.plans.length && input.pts.length > 0;
    batch.set(doc(col(COLLECTIONS.payments)), {
      clientId: input.client.id,
      clientNameSnapshot: input.client.fullName,
      invoiceId: input.latestBill?.id ?? "",
      invoiceNumber: input.latestBill?.invoiceNumber ?? "",
      membershipId: input.plans[0]?.id ?? null,
      ptAssignmentId: input.pts[0]?.id ?? null,
      amount: -refund,
      method: input.refundMethod,
      paymentDate: today,
      kind: "refund",
      note: reason,
      trainerShareAmount: 0,
      gymAmount: -refund,
      membershipGymAmount: onlyPt ? 0 : -refund,
      ptGymAmount: onlyPt ? -refund : 0,
      otherGymAmount: 0,
      createdBy: input.by.name,
      createdByUid: input.by.uid,
      counsellorId: "",
      counsellorName: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return { plans: input.plans.length + input.pts.length, refund };
}
