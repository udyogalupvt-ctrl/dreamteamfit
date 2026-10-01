import {
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { expenseSchema, type ExpenseFormValues } from "@/lib/expense-validation";
import type { Expense, ExpenseActivity, ExpenseActivityAction } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export const mapExpense = (id: string, d: DocumentData): Expense => ({
  id,
  title: d["title"] ?? "",
  category: d["category"] ?? "Other",
  amount: Number(d["amount"] ?? 0),
  paymentMethod: d["paymentMethod"] ?? "Other",
  date: d["date"] ?? "",
  description: d["description"] ?? "",
  notes: d["notes"] ?? "",
  createdBy: d["createdBy"] ?? "Staff",
  createdByUid: d["createdByUid"] ?? "",
  paidBy: d["paidBy"] || "Gym",
  settled: d["settled"] !== false,
  settledDate: d["settledDate"] ?? "",
  settledMethod: d["settledMethod"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
const mapActivity = (id: string, d: DocumentData): ExpenseActivity => ({
  id,
  expenseId: d["expenseId"] ?? "",
  expenseTitleSnapshot: d["expenseTitleSnapshot"] ?? "Expense",
  action: d["action"] ?? "created",
  createdBy: d["createdBy"] ?? "Staff",
  createdAt: toDate(d["createdAt"]),
});
const activity = (
  expenseId: string,
  title: string,
  action: ExpenseActivityAction,
  createdBy: string,
) => ({
  expenseId,
  expenseTitleSnapshot: title,
  action,
  createdBy,
  createdAt: serverTimestamp(),
});
/** Expenses dated `from` (YYYY-MM-DD) or later, newest first. */
export const subscribeExpensesSince = (
  from: string,
  ok: (items: Expense[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.expenses), where("date", ">=", from)),
    mapExpense,
    (x) => ok(x.sort((a, b) => b.date.localeCompare(a.date))),
    fail,
  );

/** Expenses paid back (settled) on `from` or later, whatever their own date. */
export const subscribeExpensesSettledSince = (
  from: string,
  ok: (items: Expense[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.expenses), where("settledDate", ">=", from)),
    mapExpense,
    ok,
    fail,
  );

export function subscribeExpenses(onData: (items: Expense[]) => void, onError: (e: Error) => void) {
  return subscribeCollection(
    COLLECTIONS.expenses,
    mapExpense,
    onData,
    onError,
    orderBy("date", "desc"),
  );
}
export function subscribeExpenseActivities(
  onData: (items: ExpenseActivity[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeCollection(
    COLLECTIONS.expenseActivities,
    mapActivity,
    onData,
    onError,
    orderBy("createdAt", "desc"),
  );
}
export async function createExpense(
  input: ExpenseFormValues,
  staff: { uid: string; name: string },
) {
  const data = expenseSchema.parse(input);
  const ref = doc(col(COLLECTIONS.expenses));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...data,
    createdBy: staff.name,
    createdByUid: staff.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(
    doc(col(COLLECTIONS.expenseActivities)),
    activity(ref.id, data.title, "created", staff.name),
  );
  await batch.commit();
  return ref.id;
}
export async function updateExpense(
  item: Expense,
  input: ExpenseFormValues,
  staff: { uid: string; name: string },
) {
  const data = expenseSchema.parse(input);
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.expenses, item.id), { ...data, updatedAt: serverTimestamp() });
  batch.set(
    doc(col(COLLECTIONS.expenseActivities)),
    activity(item.id, data.title, "updated", staff.name),
  );
  await batch.commit();
}
/** The gym paid back a person who paid an expense from their own pocket. */
export async function settleExpense(
  item: Expense,
  method: string,
  date: string,
  staff: { uid: string; name: string },
) {
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.expenses, item.id), {
    settled: true,
    settledDate: date,
    settledMethod: method,
    updatedAt: serverTimestamp(),
  });
  batch.set(
    doc(col(COLLECTIONS.expenseActivities)),
    activity(item.id, `${item.title} (paid back to ${item.paidBy})`, "updated", staff.name),
  );
  await batch.commit();
}
export async function deleteExpense(item: Expense, staff: { uid: string; name: string }) {
  const ref = doc(db, COLLECTIONS.expenses, item.id);
  const saved = (await getDoc(ref)).data();
  const batch = writeBatch(db);
  batch.delete(ref);
  batch.set(
    doc(col(COLLECTIONS.expenseActivities)),
    activity(item.id, item.title, "deleted", staff.name),
  );
  await batch.commit();
  /** Undo: the expense comes back exactly as it was. */
  return async () => {
    if (!saved) return;
    const b = writeBatch(db);
    b.set(ref, saved);
    b.set(
      doc(col(COLLECTIONS.expenseActivities)),
      activity(item.id, item.title, "created", staff.name),
    );
    await b.commit();
  };
}
