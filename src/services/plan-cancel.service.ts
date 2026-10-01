import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type {
  Client,
  Invoice,
  Membership,
  PaymentMethod,
  PtAssignment,
  TrainerPayout,
} from "@/types/models";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Cancelling plans (one gym plan, one PT plan, or "End all plans"), with an optional refund, and
 * putting everything back ("Restore" / "Undo").
 *
 * Everything one cancellation changes carries the same cancelId: the plans, the refund (a payment
 * of minus the amount, so Collected, the Day Book and reports go down by it) and the trainer's
 * share of a refunded PT plan (their unpaid payout goes down, or a minus line is added to their
 * next payout when it was already paid), and the bills of these plans whose balance is no longer
 * asked for (Closed: no more "balance due" reminders). Restore finds it all by that id.
 */

export interface RefundPart {
  kind: "gym" | "pt";
  id: string;
  name: string;
  /** Part of the refund for this plan. */
  amount: number;
  /** PT only: how much the trainer's share goes down. */
  trainerCut: number;
  trainerName: string;
}

/**
 * Splits one refund over the plans by their price (so it can be shown and booked per plan), and
 * works out each refunded PT plan's trainer share cut: share × refunded part ÷ PT price.
 */
export function splitRefund(
  refund: number,
  plans: Membership[],
  pts: PtAssignment[],
): RefundPart[] {
  const items = [
    ...plans.map((m) => ({
      kind: "gym" as const,
      id: m.id,
      name: m.packageNameSnapshot,
      price: Math.max(0, m.priceSnapshot),
      pt: null as PtAssignment | null,
    })),
    ...pts.map((p) => ({
      kind: "pt" as const,
      id: p.id,
      name: p.ptPackageNameSnapshot,
      price: Math.max(0, p.ptPrice),
      pt: p,
    })),
  ];
  const total = items.reduce((n, i) => n + i.price, 0);
  const amount = Math.max(0, Math.round(refund));
  if (!amount || !items.length) return [];
  let left = amount;
  return items.map((it, k) => {
    const share =
      k === items.length - 1
        ? left
        : total
          ? Math.min(left, Math.round((amount * it.price) / total))
          : Math.min(left, Math.round(amount / items.length));
    left -= share;
    const cut =
      it.pt && it.pt.ptPrice > 0
        ? Math.min(
            Math.max(0, it.pt.trainerShareAmount),
            Math.round(
              (Math.max(0, it.pt.trainerShareAmount) * Math.min(share, it.pt.ptPrice)) /
                it.pt.ptPrice,
            ),
          )
        : 0;
    return {
      kind: it.kind,
      id: it.id,
      name: it.name,
      amount: share,
      trainerCut: cut,
      trainerName: it.pt?.trainerNameSnapshot ?? "",
    };
  });
}

export interface CancelInput {
  client: Pick<Client, "id" | "fullName" | "currentMembership">;
  plans: Membership[];
  pts: PtAssignment[];
  /** The member's newest bill: the refund is noted against it. */
  latestBill: Pick<Invoice, "id" | "invoiceNumber"> | null;
  reason: string;
  /** Money given back to the member (0 = none). Needs Finance (trainer payouts). */
  refund: number;
  refundMethod: PaymentMethod;
  /** Bills of these plans with money still due that is not asked for any more. */
  closeBills?: Pick<Invoice, "id" | "balanceDue" | "paymentStatus" | "publicToken">[];
  by: { uid: string; name: string };
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export async function cancelPlans(input: CancelInput) {
  const cancelId = newId();
  const today = todayISO();
  const now = serverTimestamp();
  const reason = input.reason.trim().slice(0, 300);
  const parts = splitRefund(input.refund, input.plans, input.pts);
  const refund = parts.reduce((n, p) => n + p.amount, 0);

  // The trainers' payouts of refunded PT plans (read first: a batch can't read).
  const payouts = new Map<string, { id: string; data: TrainerPayout }>();
  for (const part of parts.filter((p) => p.kind === "pt" && p.trainerCut > 0)) {
    const snap = await getDocs(
      query(col(COLLECTIONS.trainerPayouts), where("ptAssignmentId", "==", part.id)),
    );
    const found = snap.docs.find(
      (d) => d.data()["status"] !== "cancelled" && !d.data()["adjustment"],
    );
    if (found) payouts.set(part.id, { id: found.id, data: found.data() as TrainerPayout });
  }

  const batch = writeBatch(db);
  const cancelled = {
    status: "cancelled",
    cancelledOn: today,
    cancelReason: reason,
    cancelId,
    updatedAt: now,
  };
  for (const m of input.plans)
    batch.update(doc(db, COLLECTIONS.memberships, m.id), {
      ...cancelled,
      statusBeforeCancel: m.status,
    });
  for (const p of input.pts)
    batch.update(doc(db, COLLECTIONS.ptAssignments, p.id), {
      ...cancelled,
      statusBeforeCancel: p.status,
    });
  const current = input.client.currentMembership?.membershipId;
  if (current && input.plans.some((m) => m.id === current))
    batch.update(doc(db, COLLECTIONS.clients, input.client.id), {
      "currentMembership.status": "cancelled",
      updatedAt: now,
    });

  let trainerCut = 0;
  for (const part of parts.filter((p) => p.kind === "pt" && p.trainerCut > 0)) {
    const pt = input.pts.find((p) => p.id === part.id)!;
    const payout = payouts.get(part.id);
    if (!payout) continue;
    trainerCut += part.trainerCut;
    const gymCut = part.amount - part.trainerCut;
    if (payout.data.status === "paid") {
      // Already paid to the trainer: taken off their next payout.
      batch.set(doc(col(COLLECTIONS.trainerPayouts)), {
        trainerId: pt.trainerId,
        trainerNameSnapshot: pt.trainerNameSnapshot,
        clientId: input.client.id,
        clientNameSnapshot: input.client.fullName,
        ptAssignmentId: pt.id,
        ptPackageNameSnapshot: pt.ptPackageNameSnapshot,
        invoiceId: payout.data.invoiceId ?? "",
        grossAmount: -part.amount,
        trainerShareAmount: -part.trainerCut,
        gymShareAmount: -gymCut,
        paymentDate: today,
        status: "pending",
        paidAt: null,
        adjustment: true,
        note: `PT cancelled, ₹${part.amount} refunded: taken off the next payout`,
        cancelId,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      batch.update(doc(db, COLLECTIONS.trainerPayouts, payout.id), {
        beforeCancel: {
          grossAmount: payout.data.grossAmount,
          trainerShareAmount: payout.data.trainerShareAmount,
          gymShareAmount: payout.data.gymShareAmount,
        },
        grossAmount: payout.data.grossAmount - part.amount,
        trainerShareAmount: payout.data.trainerShareAmount - part.trainerCut,
        gymShareAmount: payout.data.gymShareAmount - gymCut,
        cancelId,
        updatedAt: now,
      });
    }
  }

  // Balance left on the bills: not asked for any more (the bill shows Closed); kept to put back.
  for (const b of input.closeBills ?? []) {
    if (!(b.balanceDue > 0)) continue;
    batch.update(doc(db, COLLECTIONS.invoices, b.id), {
      beforeCancel: { balanceDue: b.balanceDue, paymentStatus: b.paymentStatus },
      balanceDue: 0,
      paymentStatus: "closed",
      closedAmount: b.balanceDue,
      cancelId,
      updatedAt: now,
    });
    if (b.publicToken)
      batch.update(doc(db, COLLECTIONS.publicInvoices, b.publicToken), {
        balanceDue: 0,
        paymentStatus: "closed",
        updatedAt: now,
      });
  }

  if (refund > 0) {
    const gym = parts.filter((p) => p.kind === "gym").reduce((n, p) => n + p.amount, 0);
    const pt = refund - gym;
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
      trainerShareAmount: -trainerCut,
      gymAmount: -(refund - trainerCut),
      membershipGymAmount: -gym,
      ptGymAmount: -(pt - trainerCut),
      otherGymAmount: 0,
      createdBy: input.by.name,
      createdByUid: input.by.uid,
      counsellorId: "",
      counsellorName: "",
      cancelId,
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return { cancelId, plans: input.plans.length + input.pts.length, refund, trainerCut };
}

/** Status a restored plan goes back to, from its dates (today counts as running). */
const statusByDates = (startDate: string, today: string) =>
  startDate > today ? "pending" : "active";

/**
 * Puts a cancellation back: its plans run again, its refund is removed and the trainer's share
 * goes back. A plan cancelled before cancellations had an id is restored on its own.
 */
export async function restoreCancellation(
  client: Pick<Client, "id" | "currentMembership">,
  target: { kind: "gym" | "pt"; plan: Membership | PtAssignment },
) {
  const cancelId = (target.plan as { cancelId?: string }).cancelId ?? "";
  const today = todayISO();
  const now = serverTimestamp();
  const plans: { col: string; id: string; startDate: string; endDate: string }[] = [];
  const batch = writeBatch(db);
  if (cancelId) {
    const [ms, ps, pays, bills, outs] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.memberships), where("cancelId", "==", cancelId))),
      getDocs(query(collection(db, COLLECTIONS.ptAssignments), where("cancelId", "==", cancelId))),
      getDocs(query(collection(db, COLLECTIONS.payments), where("cancelId", "==", cancelId))),
      getDocs(query(collection(db, COLLECTIONS.invoices), where("cancelId", "==", cancelId))),
      getDocs(
        query(collection(db, COLLECTIONS.trainerPayouts), where("cancelId", "==", cancelId)),
      ).catch(() => null),
    ]);
    ms.docs.forEach((d) =>
      plans.push({
        col: COLLECTIONS.memberships,
        id: d.id,
        startDate: String(d.data()["startDate"]),
        endDate: String(d.data()["endDate"]),
      }),
    );
    ps.docs.forEach((d) =>
      plans.push({
        col: COLLECTIONS.ptAssignments,
        id: d.id,
        startDate: String(d.data()["startDate"]),
        endDate: String(d.data()["endDate"]),
      }),
    );
    pays.docs.forEach((d) => batch.delete(d.ref));
    // Closed bills: the balance is asked for again.
    bills.docs.forEach((d) => {
      const x = d.data();
      const before = x["beforeCancel"] as { balanceDue: number; paymentStatus: string } | undefined;
      if (!before) return;
      batch.update(d.ref, {
        balanceDue: before.balanceDue,
        paymentStatus: before.paymentStatus,
        beforeCancel: deleteField(),
        closedAmount: deleteField(),
        cancelId: deleteField(),
        updatedAt: now,
      });
      const token = String(x["publicToken"] ?? "");
      if (token)
        batch.update(doc(db, COLLECTIONS.publicInvoices, token), {
          balanceDue: before.balanceDue,
          paymentStatus: before.paymentStatus,
          updatedAt: now,
        });
    });
    if (!outs && pays.docs.some((d) => Number(d.data()["trainerShareAmount"] ?? 0) !== 0))
      throw new Error(
        "Only the owner (or Finance) can undo a refund that changed a trainer's share.",
      );
    outs?.docs.forEach((d) => {
      const x = d.data();
      if (x["adjustment"]) batch.update(d.ref, { status: "cancelled", updatedAt: now });
      else if (x["beforeCancel"])
        batch.update(d.ref, {
          ...(x["beforeCancel"] as Record<string, number>),
          beforeCancel: deleteField(),
          cancelId: deleteField(),
          updatedAt: now,
        });
    });
  } else {
    const p = target.plan;
    plans.push({
      col: target.kind === "gym" ? COLLECTIONS.memberships : COLLECTIONS.ptAssignments,
      id: p.id,
      startDate: p.startDate,
      endDate: p.endDate,
    });
  }
  for (const p of plans)
    batch.update(doc(db, p.col, p.id), {
      status:
        p.endDate < today
          ? p.col === COLLECTIONS.memberships
            ? "expired"
            : "completed"
          : statusByDates(p.startDate, today),
      cancelledOn: deleteField(),
      cancelReason: deleteField(),
      cancelId: deleteField(),
      statusBeforeCancel: deleteField(),
      updatedAt: now,
    });
  const current = client.currentMembership;
  const back = plans.find(
    (p) => p.col === COLLECTIONS.memberships && p.id === current?.membershipId,
  );
  if (back && back.endDate >= today)
    batch.update(doc(db, COLLECTIONS.clients, client.id), {
      "currentMembership.status": statusByDates(back.startDate, today),
      updatedAt: now,
    });
  await batch.commit();
  return { plans: plans.length };
}
