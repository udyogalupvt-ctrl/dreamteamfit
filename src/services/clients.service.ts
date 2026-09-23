import {
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizePhone } from "@/lib/format";
import type { Client } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type ClientInput = Pick<
  Client,
  | "fullName"
  | "phone"
  | "email"
  | "profilePhotoUrl"
  | "dateOfBirth"
  | "gender"
  | "address"
  | "emergencyContact"
  | "source"
  | "notes"
  | "status"
>;
export type ClientUpdateInput = Partial<ClientInput & Pick<Client, "biometricUserId" | "biometricDeviceId" | "biometricStatus" | "whatsappOptIn" | "whatsappPhone" | "whatsappStatus" | "lastWhatsappMessageAt">>;

const COUNTER_REF = () => doc(db, COLLECTIONS.settings, "counters");

export const mapClient = (id: string, d: DocumentData): Client => ({
  id,
  clientCode: d["clientCode"] ?? "",
  fullName: d["fullName"] ?? "",
  phone: d["phone"] ?? "",
  phoneNormalized: d["phoneNormalized"] ?? normalizePhone(d["phone"] ?? ""),
  email: d["email"] ?? "",
  profilePhotoUrl: d["profilePhotoUrl"] ?? null,
  dateOfBirth: d["dateOfBirth"] ?? null,
  gender: d["gender"] ?? "unspecified",
  address: d["address"] ?? "",
  emergencyContact: d["emergencyContact"] ?? "",
  source: d["source"] ?? "other",
  notes: d["notes"] ?? "",
  status: d["status"] ?? "active",
  inquiryId: d["inquiryId"] ?? null,
  currentMembership: d["currentMembership"] ?? null,
  biometricUserId: d["biometricUserId"] ?? "",
  biometricDeviceId: d["biometricDeviceId"] ?? "",
  biometricStatus: d["biometricStatus"] ?? "not_enrolled",
  whatsappOptIn: Boolean(d["whatsappOptIn"]),
  whatsappPhone: d["whatsappPhone"] ?? d["phone"] ?? "",
  whatsappStatus: d["whatsappStatus"] ?? "opted_out",
  lastWhatsappMessageAt: d["lastWhatsappMessageAt"] ? toDate(d["lastWhatsappMessageAt"]) : null,
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export function subscribeClients(onData: (items: Client[]) => void, onError: (e: Error) => void) {
  return subscribeCollection(
    COLLECTIONS.clients,
    mapClient,
    onData,
    onError,
    orderBy("createdAt", "desc"),
  );
}

export function subscribeClient(
  id: string,
  onData: (item: Client | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, COLLECTIONS.clients, id),
    (s) => onData(s.exists() ? mapClient(s.id, s.data()) : null),
    onError,
  );
}

/** Returns existing clients sharing the same normalized phone number. */
export async function findClientsByPhone(phone: string, excludeId?: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const snap = await getDocs(
    query(col(COLLECTIONS.clients), where("phoneNormalized", "==", normalized)),
  );
  return snap.docs.map((d) => mapClient(d.id, d.data())).filter((c) => c.id !== excludeId);
}

/** Atomically reserves the next readable client code (CL-000001…). */
async function nextClientCode(tx: Transaction) {
  const snap = await tx.get(COUNTER_REF());
  const next = Number(snap.exists() ? (snap.data()["clientSeq"] ?? 0) : 0) + 1;
  tx.set(COUNTER_REF(), { clientSeq: next, updatedAt: serverTimestamp() }, { merge: true });
  return `CL-${String(next).padStart(6, "0")}`;
}

function clientPayload(input: ClientInput) {
  return {
    ...input,
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    phoneNormalized: normalizePhone(input.phone),
  };
}

export async function createClient(input: ClientInput, inquiryId: string | null = null) {
  const ref = doc(col(COLLECTIONS.clients));
  await runTransaction(db, async (tx) => {
    // Reads must happen before writes inside a transaction.
    const inquiryRef = inquiryId ? doc(db, COLLECTIONS.inquiries, inquiryId) : null;
    const inquirySnap = inquiryRef ? await tx.get(inquiryRef) : null;
    if (inquirySnap?.exists() && inquirySnap.data()["convertedToClient"]) {
      throw new Error("This inquiry has already been converted to a client.");
    }
    const clientCode = await nextClientCode(tx);
    tx.set(ref, {
      ...clientPayload(input),
      clientCode,
      inquiryId,
      currentMembership: null,
      biometricUserId: "",
      biometricDeviceId: "",
      biometricStatus: "not_enrolled",
      whatsappOptIn: false,
      whatsappPhone: input.phone.trim(),
      whatsappStatus: "opted_out",
      lastWhatsappMessageAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (inquiryRef) {
      tx.update(inquiryRef, {
        status: "converted",
        convertedToClient: true,
        clientId: ref.id,
        updatedAt: serverTimestamp(),
      });
    }
  });
  return ref.id;
}

export async function updateClient(id: string, input: ClientUpdateInput) {
  const patch: Record<string, unknown> = { ...input, updatedAt: serverTimestamp() };
  if (input.phone !== undefined) patch["phoneNormalized"] = normalizePhone(input.phone);
  await updateDoc(doc(db, COLLECTIONS.clients, id), patch);
}
