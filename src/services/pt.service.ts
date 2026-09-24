import { addDoc, doc, orderBy, query, serverTimestamp, updateDoc, where, type DocumentData } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type { PtAssignment, PtPackage, ShareType, Trainer } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export const mapPtPackage = (id: string, d: DocumentData): PtPackage => ({
  id, name: d["name"] ?? "", durationType: d["durationType"] ?? "monthly", durationDays: Number(d["durationDays"] ?? 0),
  price: Number(d["price"] ?? 0), description: d["description"] ?? "", isActive: d["isActive"] !== false,
  createdAt: toDate(d["createdAt"]), updatedAt: toDate(d["updatedAt"]),
});
export const mapTrainer = (id: string, d: DocumentData): Trainer => ({
  id, name: d["name"] ?? "", phone: d["phone"] ?? "", email: d["email"] ?? "", specialization: d["specialization"] ?? "",
  joiningDate: d["joiningDate"] ?? "", status: d["status"] ?? "active", defaultShareType: d["defaultShareType"] ?? "percentage",
  defaultTrainerShare: Number(d["defaultTrainerShare"] ?? 0), notes: d["notes"] ?? "",
  createdAt: toDate(d["createdAt"]), updatedAt: toDate(d["updatedAt"]),
});
export const mapPtAssignment = (id: string, d: DocumentData): PtAssignment => ({
  id, clientId: d["clientId"] ?? "", clientNameSnapshot: d["clientNameSnapshot"] ?? "", ptPackageId: d["ptPackageId"] ?? "",
  ptPackageNameSnapshot: d["ptPackageNameSnapshot"] ?? "", trainerId: d["trainerId"] ?? "", trainerNameSnapshot: d["trainerNameSnapshot"] ?? "",
  ptPrice: Number(d["ptPrice"] ?? 0), trainerShareType: d["trainerShareType"] ?? "percentage", trainerShareValue: Number(d["trainerShareValue"] ?? 0),
  trainerShareAmount: Number(d["trainerShareAmount"] ?? 0), gymShareAmount: Number(d["gymShareAmount"] ?? 0),
  startDate: d["startDate"] ?? "", endDate: d["endDate"] ?? "", status: d["status"] ?? "pending", invoiceId: d["invoiceId"] ?? "",
  enrollmentId: d["enrollmentId"] ?? null, createdAt: toDate(d["createdAt"]), updatedAt: toDate(d["updatedAt"]),
});

export const subscribePtPackages = (ok: (x: PtPackage[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.ptPackages, mapPtPackage, ok, fail, orderBy("createdAt", "desc"));
export const subscribeTrainers = (ok: (x: Trainer[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.trainers, mapTrainer, ok, fail, orderBy("createdAt", "desc"));
export const subscribePtAssignments = (ok: (x: PtAssignment[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.ptAssignments, mapPtAssignment, ok, fail, orderBy("createdAt", "desc"));
export const subscribeClientPtAssignments = (clientId: string, ok: (x: PtAssignment[]) => void, fail: (e: Error) => void) =>
  subscribeQuery(query(col(COLLECTIONS.ptAssignments), where("clientId", "==", clientId)), mapPtAssignment,
    (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())), fail);

export type PtPackageInput = Omit<PtPackage, "id" | "createdAt" | "updatedAt">;
export type TrainerInput = Omit<Trainer, "id" | "createdAt" | "updatedAt">;

export async function savePtPackage(input: PtPackageInput, id?: string) {
  if (id) { await updateDoc(doc(db, COLLECTIONS.ptPackages, id), { ...input, updatedAt: serverTimestamp() }); return id; }
  return (await addDoc(col(COLLECTIONS.ptPackages), { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id;
}
export async function saveTrainer(input: TrainerInput, id?: string) {
  if (id) { await updateDoc(doc(db, COLLECTIONS.trainers, id), { ...input, updatedAt: serverTimestamp() }); return id; }
  return (await addDoc(col(COLLECTIONS.trainers), { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Trainer/gym split. Admin decides type and value; nothing is hardcoded. */
export function calculateShare(ptPrice: number, type: ShareType, value: number) {
  const raw = type === "percentage" ? (ptPrice * Math.min(Math.max(value, 0), 100)) / 100 : Math.max(value, 0);
  const trainerShareAmount = round(Math.min(raw, ptPrice));
  return { ptPrice, trainerShareType: type, trainerShareValue: value, trainerShareAmount, gymShareAmount: round(ptPrice - trainerShareAmount) };
}

export const PT_DURATION_LABELS = { day: "Day", monthly: "Monthly", yearly: "Yearly", custom: "Custom" } as const;
export const DEFAULT_PT_DAYS = { day: 1, monthly: 30, yearly: 365, custom: 30 } as const;
