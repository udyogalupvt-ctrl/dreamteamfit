import {
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import type { GymPackage } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";

export type PackageInput = Pick<
  GymPackage,
  "name" | "category" | "description" | "durationDays" | "price" | "isActive"
>;

export const mapPackage = (id: string, d: DocumentData): GymPackage => ({
  id,
  name: d["name"] ?? "",
  category: d["category"] ?? "Custom",
  description: d["description"] ?? "",
  durationDays: Number(d["durationDays"] ?? 0),
  price: Number(d["price"] ?? 0),
  isActive: Boolean(d["isActive"]),
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export function subscribePackages(
  onData: (items: GymPackage[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeCollection(
    COLLECTIONS.packages,
    mapPackage,
    onData,
    onError,
    orderBy("createdAt", "desc"),
  );
}

export async function createPackage(input: PackageInput) {
  const ref = await addDoc(col(COLLECTIONS.packages), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePackage(id: string, input: Partial<PackageInput>) {
  await updateDoc(doc(db, COLLECTIONS.packages, id), { ...input, updatedAt: serverTimestamp() });
}

/** True when any membership references the package — deleting would orphan history. */
export async function isPackageInUse(id: string) {
  const snap = await getDocs(
    query(col(COLLECTIONS.memberships), where("packageId", "==", id), limit(1)),
  );
  return !snap.empty;
}

export async function deletePackage(id: string) {
  if (await isPackageInUse(id)) {
    throw new Error(
      "This package is used by existing memberships. Deactivate it instead to keep history intact.",
    );
  }
  await deleteDoc(doc(db, COLLECTIONS.packages, id));
}
