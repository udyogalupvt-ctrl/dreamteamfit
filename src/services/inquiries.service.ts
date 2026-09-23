import {
  addDoc,
  doc,
  onSnapshot,
  orderBy,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizePhone } from "@/lib/format";
import type { Inquiry } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type InquiryInput = Pick<
  Inquiry,
  "name" | "phone" | "email" | "source" | "fitnessGoal" | "notes" | "status" | "nextFollowUpDate"
> & Partial<Pick<Inquiry, "lastContactDate" | "expectedJoinDate" | "expectedVisitDate" | "assignedTo">>;

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

export async function createInquiry(input: InquiryInput) {
  const ref = await addDoc(col(COLLECTIONS.inquiries), {
    ...input,
    phoneNormalized: normalizePhone(input.phone),
    convertedToClient: false,
    clientId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (input.nextFollowUpDate) {
    const { syncInquiryFollowUp } = await import("./followups.service");
    await syncInquiryFollowUp(ref.id);
  }
  return ref.id;
}

export async function updateInquiry(id: string, input: Partial<InquiryInput>) {
  const patch: Record<string, unknown> = { ...input, updatedAt: serverTimestamp() };
  if (input.phone !== undefined) patch["phoneNormalized"] = normalizePhone(input.phone);
  await updateDoc(doc(db, COLLECTIONS.inquiries, id), patch);
  if (input.nextFollowUpDate !== undefined && input.nextFollowUpDate) {
    const { syncInquiryFollowUp } = await import("./followups.service");
    await syncInquiryFollowUp(id);
  }
}
