import {
  doc,
  getDoc,
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
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { normalizePhone } from "@/lib/format";
import { createPublicToken } from "@/lib/invoice-utils";
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
export type ClientUpdateInput = Partial<
  ClientInput &
    Pick<
      Client,
      | "biometricUserId"
      | "biometricDeviceId"
      | "biometricStatus"
      | "whatsappOptIn"
      | "whatsappPhone"
      | "whatsappStatus"
      | "lastWhatsappMessageAt"
    >
>;

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
  firstThumbRegistered: Boolean(d["firstThumbRegistered"]),
  photoUploadToken: d["photoUploadToken"] ?? "",
  enrollmentId: d["enrollmentId"] ?? null,
  deviceAccess:
    d["deviceAccess"] === "removed" ? "removed" : d["deviceAccess"] === "on" ? "on" : null,
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

// ------------------------------------------------------------------ member ID

/**
 * Member IDs are plain numbers (1, 2, 3…), the same number used on the fingerprint machine.
 * 9001 and up belong to staff on the machine, so members stay below.
 */
export const MAX_MEMBER_ID = 8999;
const memberIdRef = (id: string) => doc(db, COLLECTIONS.memberIds, id);
const idNumber = (code: string) => Number.parseInt(code.replace(/\D/g, ""), 10) || 0;
/** "007" → "7". */
export const cleanMemberId = (id: string) => id.trim().replace(/^0+(?=\d)/, "");
/** How an ID is shown: "ID 12" (old codes like CL-000012 as they are). */
export const memberIdLabel = (code: string) => (/^\d+$/.test(code) ? `ID ${code}` : code);

/** The next free member ID: one more than the highest in use (1 when there are no members). */
export async function suggestMemberId() {
  const snap = await getDocs(col(COLLECTIONS.clients));
  const max = snap.docs.reduce(
    (n, d) => Math.max(n, idNumber(String(d.data()["clientCode"] ?? ""))),
    0,
  );
  return String(Math.min(max + 1, MAX_MEMBER_ID));
}

/** Why this ID can't be given, or "" when it is free. */
export async function memberIdProblem(raw: string, excludeClientId?: string) {
  const id = cleanMemberId(raw);
  if (!/^\d{1,4}$/.test(id) || Number(id) < 1 || Number(id) > MAX_MEMBER_ID)
    return `Use a number from 1 to ${MAX_MEMBER_ID}`;
  const [reserved, same] = await Promise.all([
    getDoc(memberIdRef(id)),
    getDocs(query(col(COLLECTIONS.clients), where("clientCode", "==", id))),
  ]);
  const owner = same.docs.find((d) => d.id !== excludeClientId);
  if (owner) return `ID ${id} belongs to ${String(owner.data()["fullName"] ?? "another member")}`;
  if (reserved.exists() && reserved.data()["clientId"] !== excludeClientId)
    return `ID ${id} is already taken`;
  return "";
}

/**
 * Inside the save transaction (call before any write): claims the ID so two desks can never
 * give out the same number. Returns the write to add once all reads are done.
 */
export async function claimMemberId(tx: Transaction, raw: string, clientId: string) {
  const id = cleanMemberId(raw);
  const s = await tx.get(memberIdRef(id));
  if (s.exists() && s.data()["clientId"] !== clientId)
    throw new Error(`Member ID ${id} was just given to someone else. Pick another ID.`);
  return {
    id,
    write: () => tx.set(memberIdRef(id), { clientId, createdAt: serverTimestamp() }),
  };
}

/** Frees a deleted member's ID so it can be given again. */
export const memberIdDocRef = (code: string) => (/^\d+$/.test(code) ? memberIdRef(code) : null);

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
  const memberId = await suggestMemberId();
  await runTransaction(db, async (tx) => {
    // Reads must happen before writes inside a transaction.
    const inquiryRef = inquiryId ? doc(db, COLLECTIONS.inquiries, inquiryId) : null;
    const inquirySnap = inquiryRef ? await tx.get(inquiryRef) : null;
    if (inquirySnap?.exists() && inquirySnap.data()["convertedToClient"]) {
      throw new Error("This inquiry has already been converted to a client.");
    }
    const claim = await claimMemberId(tx, memberId, ref.id);
    const clientCode = claim.id;
    claim.write();
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

/** Code for the member's photo upload link (/photo/<code>); made once, cleared after upload. */
export async function ensurePhotoLink(clientId: string) {
  const ref = doc(db, COLLECTIONS.clients, clientId);
  const snap = await getDoc(ref);
  const existing = String(snap.data()?.["photoUploadToken"] ?? "");
  if (existing) return existing;
  const token = createPublicToken();
  await updateDoc(ref, { photoUploadToken: token, updatedAt: serverTimestamp() });
  return token;
}
