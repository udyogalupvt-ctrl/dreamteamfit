import * as XLSX from "xlsx";
import { getDocs, Timestamp } from "firebase/firestore";
import { col, COLLECTIONS, type CollectionName } from "./firestore.service";

export interface ExportDef { id: string; label: string; collection: CollectionName; dateField?: string }
export const EXPORTS: ExportDef[] = [
  { id: "clients", label: "Clients", collection: COLLECTIONS.clients, dateField: "createdAt" },
  { id: "memberships", label: "Memberships", collection: COLLECTIONS.memberships, dateField: "startDate" },
  { id: "invoices", label: "Invoices", collection: COLLECTIONS.invoices, dateField: "invoiceDate" },
  { id: "payments", label: "Payments", collection: COLLECTIONS.payments, dateField: "paymentDate" },
  { id: "expenses", label: "Expenses", collection: COLLECTIONS.expenses, dateField: "date" },
  { id: "attendance", label: "Attendance", collection: COLLECTIONS.attendance, dateField: "attendanceDate" },
  { id: "trainers", label: "Trainers", collection: COLLECTIONS.trainers },
  { id: "workoutAssignments", label: "Workout Assignments", collection: COLLECTIONS.workoutAssignments, dateField: "startDate" },
  { id: "dietAssignments", label: "Diet Assignments", collection: COLLECTIONS.dietAssignments, dateField: "startDate" },
  { id: "bookings", label: "Bookings", collection: COLLECTIONS.bookings, dateField: "date" },
];

/** Never exported: secrets, public access tokens and any raw biometric payloads. */
const BLOCKED = /token|secret|password|apikey|api_key|credential|template|fingerprintdata|rawbiometric|privatekey/i;

function cell(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v, (k, x) => (BLOCKED.test(k) ? undefined : x instanceof Timestamp ? x.toDate().toISOString() : x));
  return v as string | number | boolean;
}
const dateOf = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

export async function exportCollection(def: ExportDef, format: "csv" | "xlsx", from?: string, to?: string) {
  const snap = await getDocs(col(def.collection));
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
    .filter((r) => { if (!def.dateField) return true; const d = dateOf(r[def.dateField]); return (!from || d >= from) && (!to || d <= to); })
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !BLOCKED.test(k)).map(([k, v]) => [k, cell(v)])));
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, def.label.slice(0, 31));
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `rebuild-fitness-${def.id}-${stamp}.${format}`, { bookType: format });
  return rows.length;
}
