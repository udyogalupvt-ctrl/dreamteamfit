import {
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  onSnapshot,
  orderBy,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, normalizePhone, todayISO } from "@/lib/format";
import { toReferredBy } from "@/lib/referrals";
import type { Inquiry } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type InquiryInput = Pick<
  Inquiry,
  "name" | "phone" | "email" | "source" | "fitnessGoal" | "notes" | "status" | "nextFollowUpDate"
> &
  Partial<
    Pick<
      Inquiry,
      | "lastContactDate"
      | "expectedJoinDate"
      | "expectedVisitDate"
      | "assignedTo"
      | "counsellorId"
      | "referredBy"
    >
  >;

export const mapInquiry = (id: string, d: DocumentData): Inquiry => ({
  id,
  name: d["name"] ?? "",
  phone: d["phone"] ?? "",
  phoneNormalized: d["phoneNormalized"] ?? normalizePhone(d["phone"] ?? ""),
  email: d["email"] ?? "",
  source: d["source"] ?? "other",
  fitnessGoal: d["fitnessGoal"] ?? "",
  notes: d["notes"] ?? "",
  status: d["status"] ?? "new",
  nextFollowUpDate: d["nextFollowUpDate"] ?? null,
  lastContactDate: d["lastContactDate"] ?? null,
  expectedJoinDate: d["expectedJoinDate"] ?? null,
  expectedVisitDate: d["expectedVisitDate"] ?? null,
  assignedTo: d["assignedTo"] ?? "",
  counsellorId: d["counsellorId"] ?? "",
  convertedToClient: Boolean(d["convertedToClient"]),
  clientId: d["clientId"] ?? null,
  referredBy: toReferredBy(d["referredBy"]),
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export function subscribeInquiries(
  onData: (items: Inquiry[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeCollection(
    COLLECTIONS.inquiries,
    mapInquiry,
    onData,
    onError,
    orderBy("createdAt", "desc"),
  );
}

export function subscribeInquiry(
  id: string,
  onData: (item: Inquiry | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, COLLECTIONS.inquiries, id),
    (s) => onData(s.exists() ? mapInquiry(s.id, s.data()) : null),
    onError,
  );
}

/**
 * Saves the lead and its first follow-up call in ONE write, so a lead can never exist
 * without its call (even if the tab is closed right after saving).
 */
export async function createInquiry(input: InquiryInput) {
  const ref = doc(col(COLLECTIONS.inquiries));
  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(ref, {
    ...input,
    phoneNormalized: normalizePhone(input.phone),
    convertedToClient: false,
    clientId: null,
    createdAt: now,
    updatedAt: now,
  });
  if (input.nextFollowUpDate)
    batch.set(doc(db, COLLECTIONS.followups, `inquiry_${ref.id}`), {
      clientId: "",
      inquiryId: ref.id,
      clientNameSnapshot: input.name,
      phoneSnapshot: input.phone,
      source: "inquiry",
      reason: "Follow-up call",
      notes: input.notes,
      followUpDate: input.nextFollowUpDate,
      followUpTime: "10:00",
      status: "pending",
      priority: "medium",
      assignedTo: "",
      lastContactDate: null,
      nextAction: "Call the lead",
      outcome: "",
      automated: false,
      parentFollowUpId: null,
      createdAt: now,
      updatedAt: now,
    });
  await batch.commit();
  return ref.id;
}

export async function updateInquiry(id: string, input: Partial<InquiryInput>) {
  const patch: Record<string, unknown> = { ...input, updatedAt: serverTimestamp() };
  if (input.phone !== undefined) patch["phoneNormalized"] = normalizePhone(input.phone);
  await updateDoc(doc(db, COLLECTIONS.inquiries, id), patch);
  // Date or status changes move / close the lead's single pending call.
  if (input.nextFollowUpDate !== undefined || input.status !== undefined) {
    const { syncInquiryFollowUp } = await import("./followups.service");
    await syncInquiryFollowUp(id);
  }
}

/**
 * A lead marked Not interested (or wrong number) came back: open again as Interested with a call
 * today, and a dated line in the notes so the history shows it. Returns the undo.
 */
export async function reopenInquiry(i: Inquiry, by: string) {
  const today = todayISO();
  const line = `[${formatDateISO(today)}] Came back after "Not interested"${by ? ` (${by})` : ""}`;
  await updateInquiry(i.id, {
    status: "interested",
    nextFollowUpDate: today,
    notes: i.notes ? `${i.notes}
${line}` : line,
  });
  return () =>
    updateInquiry(i.id, { status: i.status, nextFollowUpDate: i.nextFollowUpDate, notes: i.notes });
}

/** Leads already saved with this phone (a new inquiry from a known number reopens the old one). */
export async function findInquiriesByPhone(phone: string) {
  const key = normalizePhone(phone);
  if (key.length < 10) return [];
  const snap = await getDocs(
    query(col(COLLECTIONS.inquiries), where("phoneNormalized", "==", key)),
  );
  return snap.docs.map((d) => mapInquiry(d.id, d.data()));
}

/** Leads still being worked on (not converted, not lost). */
export const subscribeOpenInquiries = (
  onData: (items: Inquiry[]) => void,
  onError: (e: Error) => void,
) =>
  subscribeCollection(
    COLLECTIONS.inquiries,
    mapInquiry,
    onData,
    onError,
    where("status", "not-in", ["converted", "lost"]),
  );
