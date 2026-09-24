import {
  writeBatch,
  doc,
  onSnapshot,
  orderBy,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { normalizePhone } from "@/lib/format";
import type { Inquiry } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type InquiryInput = Pick<
  Inquiry,
  "name" | "phone" | "email" | "source" | "fitnessGoal" | "notes" | "status" | "nextFollowUpDate"
> &
  Partial<
    Pick<Inquiry, "lastContactDate" | "expectedJoinDate" | "expectedVisitDate" | "assignedTo">
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
  convertedToClient: Boolean(d["convertedToClient"]),
  clientId: d["clientId"] ?? null,
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
