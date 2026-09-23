import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type QueryConstraint,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";

/**
 * Thin, typed Firestore access layer.
 * Feature modules build on these helpers instead of importing Firestore directly.
 */
export const COLLECTIONS = {
  gyms: "gyms",
  staff: "staff",
  inquiries: "inquiries",
  clients: "clients",
  packages: "packages",
  invoices: "invoices",
  attendance: "attendance",
  followUps: "followUps",
  settings: "settings",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export async function listDocs<T>(name: CollectionName, ...constraints: QueryConstraint[]) {
  const snapshot = await getDocs(query(collection(getDb(), name), ...constraints));
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

export async function getDocById<T>(name: CollectionName, id: string) {
  const snapshot = await getDoc(doc(getDb(), name, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...(snapshot.data() as T) }) : null;
}

export async function createDoc<T extends Record<string, unknown>>(
  name: CollectionName,
  data: T,
) {
  const ref = await addDoc(collection(getDb(), name), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function upsertDoc<T extends Record<string, unknown>>(
  name: CollectionName,
  id: string,
  data: T,
) {
  await setDoc(
    doc(getDb(), name, id),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function updateDocById(
  name: CollectionName,
  id: string,
  data: Record<string, unknown>,
) {
  await updateDoc(doc(getDb(), name, id), { ...data, updatedAt: serverTimestamp() });
}

export async function removeDoc(name: CollectionName, id: string) {
  await deleteDoc(doc(getDb(), name, id));
}
