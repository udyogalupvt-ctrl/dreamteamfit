import {
  doc,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type { FollowUp, FollowUpPriority, FollowUpSource } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export type FollowUpInput = {
  clientId: string;
  inquiryId: string | null;
  clientNameSnapshot: string;
  phoneSnapshot: string;
  source: FollowUpSource;
  reason: string;
  notes: string;
  followUpDate: string;
  followUpTime: string;
  priority: FollowUpPriority;
  assignedTo: string;
  nextAction: string;
  outcome: string;
  automated?: boolean;
  parentFollowUpId?: string | null;
};

export const mapFollowUp = (id: string, d: DocumentData): FollowUp => ({
  id,
  clientId: d["clientId"] ?? "",
  inquiryId: d["inquiryId"] ?? null,
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  phoneSnapshot: d["phoneSnapshot"] ?? "",
  source: d["source"] ?? "general",
  reason: d["reason"] ?? "",
  notes: d["notes"] ?? "",
  followUpDate: d["followUpDate"] ?? "",
  followUpTime: d["followUpTime"] ?? "09:00",
  status: d["status"] ?? "pending",
  priority: d["priority"] ?? "medium",
  assignedTo: d["assignedTo"] ?? "",
  lastContactDate: d["lastContactDate"] ?? null,
  nextAction: d["nextAction"] ?? "",
  outcome: d["outcome"] ?? "",
  automated: Boolean(d["automated"]),
  parentFollowUpId: d["parentFollowUpId"] ?? null,
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeFollowUps = (ok: (x: FollowUp[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.followups,
    mapFollowUp,
    (items) =>
      ok(
        items
          // Rows without a name are fragments of old writes; they are not real calls.
          .filter((x) => x.clientNameSnapshot && x.followUpDate)
          .sort((a, b) =>
            `${a.followUpDate}${a.followUpTime}`.localeCompare(
              `${b.followUpDate}${b.followUpTime}`,
            ),
          ),
      ),
    fail,
    orderBy("createdAt", "desc"),
  );

export const subscribeClientFollowUps = (
  clientId: string,
  ok: (x: FollowUp[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.followups), where("clientId", "==", clientId)),
    mapFollowUp,
    (x) => ok(x.sort((a, b) => b.followUpDate.localeCompare(a.followUpDate))),
    fail,
  );

export async function saveFollowUp(input: FollowUpInput, id?: string) {
  const ref = id ? doc(db, COLLECTIONS.followups, id) : doc(col(COLLECTIONS.followups));
  await runTransaction(db, async (tx) => {
    const now = serverTimestamp();
    tx.set(
      ref,
      {
        ...input,
        automated: Boolean(input.automated),
        parentFollowUpId: input.parentFollowUpId ?? null,
        status: "pending",
        lastContactDate: null,
        ...(id ? {} : { createdAt: now }),
        updatedAt: now,
      },
      { merge: Boolean(id) },
    );
    tx.set(doc(col(COLLECTIONS.automationActivities)), {
      type: "followup_created",
      referenceId: ref.id,
      clientId: input.clientId,
      clientNameSnapshot: input.clientNameSnapshot,
      description: `Follow-up created: ${input.reason}`,
      createdAt: now,
      updatedAt: now,
    });
  });
  return ref.id;
}

/** Moves a call to a new date/time. For leads the lead's next call date moves with it. */
export async function rescheduleFollowUp(item: FollowUp, date: string, time: string) {
  const batch = writeBatch(db),
    now = serverTimestamp();
  batch.update(doc(db, COLLECTIONS.followups, item.id), {
    followUpDate: date,
    followUpTime: time,
    status: "pending",
    updatedAt: now,
  });
  if (item.inquiryId)
    batch.update(doc(db, COLLECTIONS.inquiries, item.inquiryId), {
      nextFollowUpDate: date,
      updatedAt: now,
    });
  await batch.commit();
}

export async function cancelFollowUp(id: string) {
  await updateDoc(doc(db, COLLECTIONS.followups, id), {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });
}

/**
 * Keeps the lead's single live call (`inquiry_<id>`) in step with its next follow-up date.
 * Converted / lost leads, or leads with no date, have no pending call.
 */
export async function syncInquiryFollowUp(inquiryId: string) {
  const inquiryRef = doc(db, COLLECTIONS.inquiries, inquiryId),
    stableRef = doc(db, COLLECTIONS.followups, `inquiry_${inquiryId}`);
  await runTransaction(db, async (tx) => {
    const [inq, existing] = await Promise.all([tx.get(inquiryRef), tx.get(stableRef)]);
    if (!inq.exists()) return;
    const d = inq.data(),
      date = d["nextFollowUpDate"] as string | null,
      closed = d["status"] === "converted" || d["status"] === "lost";
    const now = serverTimestamp();
    if (!date || closed) {
      if (existing.exists() && existing.data()["status"] === "pending")
        tx.update(stableRef, { status: closed ? "completed" : "cancelled", updatedAt: now });
      return;
    }
    const prev = existing.data() ?? {};
    tx.set(
      stableRef,
      {
        clientId: d["clientId"] ?? "",
        inquiryId,
        clientNameSnapshot: d["name"] ?? "",
        phoneSnapshot: d["phone"] ?? "",
        source: "inquiry",
        reason: prev["reason"] ?? "Follow-up call",
        notes: prev["notes"] ?? d["notes"] ?? "",
        followUpDate: date,
        followUpTime: prev["followUpTime"] ?? "10:00",
        status: "pending",
        priority: prev["priority"] ?? "medium",
        assignedTo: prev["assignedTo"] ?? "",
        lastContactDate: prev["lastContactDate"] ?? null,
        nextAction: prev["nextAction"] ?? "Call the lead",
        outcome: "",
        automated: false,
        parentFollowUpId: null,
        createdAt: prev["createdAt"] ?? now,
        updatedAt: now,
      },
      { merge: true },
    );
  });
}

export const followUpDueToday = (x: FollowUp, today = todayISO()) =>
  x.status === "pending" && x.followUpDate <= today;
