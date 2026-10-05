import {
  addDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { expenseSchema, type ExpenseFormValues } from "@/lib/expense-validation";
import type { Expense, ExpenseActivity, ExpenseActivityAction } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";
import { binExpense, type Deleter } from "./recycle-bin.service";

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
  ...(d["staffPaymentId"] ? { staffPaymentId: String(d["staffPaymentId"]) } : {}),
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
/** The staff pay record made with a salary / incentive expense (only those have one). */
export async function staffPaymentRefs(item: Pick<Expense, "id" | "category" | "staffPaymentId">) {
  if (item.staffPaymentId) return [doc(db, COLLECTIONS.staffPayments, item.staffPaymentId)];
  // Paid before expenses kept the link: look it up (only Income & expenses logins may read it;
  // others edit the expense alone, as before).
  if (item.category !== "Staff Salary" && item.category !== "Incentive") return [];
  const snap = await getDocs(
    query(col(COLLECTIONS.staffPayments), where("expenseId", "==", item.id)),
  ).catch(() => null);
  return snap ? snap.docs.map((d) => d.ref) : [];
}

export async function updateExpense(
  item: Expense,
  input: ExpenseFormValues,
  staff: { uid: string; name: string },
) {
  const data = expenseSchema.parse(input);
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.expenses, item.id), { ...data, updatedAt: serverTimestamp() });
  // A salary / incentive paid on the Staff page: its pay record follows (amount, mode, date).
  for (const ref of await staffPaymentRefs(item))
    batch.update(ref, {
      amount: data.amount,
      method: data.paymentMethod,
      date: data.date,
      notes: data.notes ?? "",
      updatedAt: serverTimestamp(),
    });
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
/** Delete = into the Recycle Bin (restorable), with a "removed" line in the expense history. */
export async function deleteExpense(item: Expense, by: Deleter) {
  const binId = await binExpense(item, by);
  await setDoc(
    doc(col(COLLECTIONS.expenseActivities)),
    activity(item.id, item.title, "deleted", by.name),
  );
  return binId;
}
