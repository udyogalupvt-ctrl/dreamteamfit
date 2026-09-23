import * as XLSX from "xlsx";
import { normalizePhone, todayISO } from "@/lib/format";
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS, GENDERS, PACKAGE_CATEGORIES, type Client, type Expense, type GymPackage, type ImportType, type Membership, type Trainer } from "@/types/models";

export type FieldKind = "text" | "phone" | "date" | "number" | "email";
export interface FieldDef { key: string; label: string; required?: boolean; kind: FieldKind; aliases: string[] }

export const IMPORT_LABELS: Record<ImportType, string> = { clients: "Clients", packages: "Packages", trainers: "Trainers", memberships: "Memberships", expenses: "Expenses" };

export const IMPORT_FIELDS: Record<ImportType, FieldDef[]> = {
  clients: [
    { key: "fullName", label: "Full name", required: true, kind: "text", aliases: ["name", "customer name", "client name", "member name", "full name", "customer"] },
    { key: "phone", label: "Phone", required: true, kind: "phone", aliases: ["phone", "mobile", "mobile number", "phone number", "contact", "contact number", "mobile no", "whatsapp"] },
    { key: "email", label: "Email", kind: "email", aliases: ["email", "email id", "mail", "e-mail"] },
    { key: "dateOfBirth", label: "Date of birth", kind: "date", aliases: ["dob", "date of birth", "birthday", "birth date"] },
    { key: "gender", label: "Gender", kind: "text", aliases: ["gender", "sex"] },
    { key: "address", label: "Address", kind: "text", aliases: ["address", "location", "city"] },
    { key: "emergencyContact", label: "Emergency contact", kind: "text", aliases: ["emergency", "emergency contact", "emergency number"] },
    { key: "notes", label: "Notes", kind: "text", aliases: ["notes", "remarks", "comment", "comments"] },
  ],
  packages: [
    { key: "name", label: "Package name", required: true, kind: "text", aliases: ["name", "package", "package name", "plan", "plan name"] },
    { key: "durationDays", label: "Duration (days)", required: true, kind: "number", aliases: ["duration", "days", "duration days", "validity", "validity days"] },
    { key: "price", label: "Price", required: true, kind: "number", aliases: ["price", "amount", "fee", "fees", "cost", "rate"] },
    { key: "category", label: "Category", kind: "text", aliases: ["category", "type", "training type"] },
    { key: "description", label: "Description", kind: "text", aliases: ["description", "details", "notes"] },
  ],
  trainers: [
    { key: "name", label: "Trainer name", required: true, kind: "text", aliases: ["name", "trainer", "trainer name", "coach"] },
    { key: "phone", label: "Phone", kind: "phone", aliases: ["phone", "mobile", "mobile number", "contact"] },
    { key: "email", label: "Email", kind: "email", aliases: ["email", "mail"] },
    { key: "specialization", label: "Specialization", kind: "text", aliases: ["specialization", "speciality", "specialty", "skill"] },
    { key: "joiningDate", label: "Joining date", kind: "date", aliases: ["joining date", "join date", "doj", "joined"] },
    { key: "shareValue", label: "Trainer share %", kind: "number", aliases: ["share", "trainer share", "share %", "commission", "percentage"] },
  ],
  memberships: [
    { key: "phone", label: "Client phone", required: true, kind: "phone", aliases: ["phone", "mobile", "mobile number", "contact", "phone number"] },
    { key: "clientName", label: "Client name", kind: "text", aliases: ["name", "customer name", "client name", "member name"] },
    { key: "packageName", label: "Package", required: true, kind: "text", aliases: ["package", "plan", "package name", "membership", "membership type"] },
    { key: "startDate", label: "Start date", required: true, kind: "date", aliases: ["start", "start date", "membership start", "from", "joining date"] },
    { key: "endDate", label: "End date", kind: "date", aliases: ["end", "end date", "membership end", "to", "expiry", "expiry date", "valid till"] },
    { key: "price", label: "Price paid", kind: "number", aliases: ["price", "amount", "fee", "paid"] },
    { key: "status", label: "Status", kind: "text", aliases: ["status", "membership status"] },
    { key: "trainerName", label: "Trainer", kind: "text", aliases: ["trainer", "trainer name", "coach", "pt trainer"] },
  ],
  expenses: [
    { key: "title", label: "Title", required: true, kind: "text", aliases: ["title", "expense", "description", "item", "particulars"] },
    { key: "amount", label: "Amount", required: true, kind: "number", aliases: ["amount", "cost", "total", "value"] },
    { key: "date", label: "Date", required: true, kind: "date", aliases: ["date", "expense date", "paid on"] },
    { key: "category", label: "Category", kind: "text", aliases: ["category", "type", "head"] },
    { key: "paymentMethod", label: "Payment method", kind: "text", aliases: ["payment method", "mode", "payment mode", "method"] },
    { key: "notes", label: "Notes", kind: "text", aliases: ["notes", "remarks"] },
  ],
};

export type RawRow = Record<string, unknown>;
export interface ParsedFile { headers: string[]; rows: RawRow[]; sheetNames: string[] }

export async function readSpreadsheet(file: File, sheet?: string): Promise<ParsedFile> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  if (!name) throw new Error("The file has no sheets.");
  const ws = wb.Sheets[name]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const headers = (matrix[0] ?? []).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  const rows = matrix.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows, sheetNames: wb.SheetNames };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Suggests header → field mapping using exact alias match, then partial match. */
export function suggestMapping(type: ImportType, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const pass of [0, 1]) for (const f of IMPORT_FIELDS[type]) {
    if (map[f.key]) continue;
    const h = headers.find((x) => !used.has(x) && (pass === 0 ? f.aliases.includes(norm(x)) || norm(x) === norm(f.key) || norm(x) === norm(f.label) : f.aliases.some((a) => a.length > 3 && norm(x).includes(a))));
    if (h) { map[f.key] = h; used.add(h); }
  }
  return map;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };
/** Parses Excel dates, ISO, and Indian-style DD/MM/YYYY. Returns null when invalid. */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number" && v > 1000 && v < 100000) { const p = XLSX.SSF.parse_date_code(v); return p ? iso(p.y, p.m, p.d) : null; }
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) { const y = +m[3]! < 100 ? 2000 + +m[3]! : +m[3]!; return iso(y, +m[2]!, +m[1]!); }
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /[a-z]/i.test(s)) { const d = new Date(t); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  return null;
}
export const parseNumber = (v: unknown) => { if (typeof v === "number") return v; const s = String(v ?? "").replace(/[₹,\s]|rs\.?|inr/gi, ""); return s === "" ? NaN : Number(s); };
const str = (v: unknown) => (v instanceof Date ? parseDate(v) ?? "" : String(v ?? "")).trim();

export type Resolution = { mode: "map"; id: string } | { mode: "create"; price?: number; durationDays?: number } | { mode: "skip" };
export type DupAction = "skip" | "update" | "create";
export interface RowError { field: string; reason: string }
export interface ValidatedRow { row: number; raw: RawRow; data: Record<string, unknown>; errors: RowError[]; warnings: string[]; duplicate: { id: string; label: string; incoming: string } | null; action: DupAction | "create" | "skip" }

export interface ImportContext { clients: Client[]; packages: GymPackage[]; trainers: Trainer[]; memberships: Membership[]; expenses: Expense[]; packageRes: Record<string, Resolution>; trainerRes: Record<string, Resolution>; dupActions: Record<number, DupAction> }

export const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function unknownNames(type: ImportType, rows: RawRow[], mapping: Record<string, string>, ctx: Pick<ImportContext, "packages" | "trainers">) {
  if (type !== "memberships") return { packages: [] as string[], trainers: [] as string[] };
  const pk = new Set(ctx.packages.map((p) => key(p.name))), tr = new Set(ctx.trainers.map((t) => key(t.name)));
  const P = new Map<string, string>(), T = new Map<string, string>();
  for (const r of rows) {
    const p = str(mapping["packageName"] ? r[mapping["packageName"]] : ""); if (p && !pk.has(key(p))) P.set(key(p), p);
    const t = str(mapping["trainerName"] ? r[mapping["trainerName"]] : ""); if (t && !tr.has(key(t))) T.set(key(t), t);
  }
  return { packages: [...P.values()], trainers: [...T.values()] };
}

const addDays = (d: string, n: number) => { const dt = new Date(`${d}T00:00:00`); dt.setDate(dt.getDate() + n); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; };

export function validateRows(type: ImportType, rows: RawRow[], mapping: Record<string, string>, ctx: ImportContext): ValidatedRow[] {
  const fields = IMPORT_FIELDS[type];
  const seen = new Map<string, number>();
  const clientsByPhone = new Map(ctx.clients.map((c) => [c.phoneNormalized || normalizePhone(c.phone), c]));
  return rows.map((raw, i) => {
    const row = i + 2; // header is spreadsheet row 1
    const errors: RowError[] = [], warnings: string[] = [], data: Record<string, unknown> = {};
    for (const f of fields) {
      const col = mapping[f.key]; const v = col ? raw[col] : "";
      const s = str(v);
      if (!s) { if (f.required) errors.push({ field: f.label, reason: `Missing ${f.label.toLowerCase()}` }); data[f.key] = f.kind === "number" ? null : ""; continue; }
      if (f.kind === "phone") { const p = normalizePhone(s); if (p.length !== 10) errors.push({ field: f.label, reason: "Invalid phone number" }); data[f.key] = s; data["phoneNormalized"] = p; }
      else if (f.kind === "date") { const d = parseDate(v); if (!d) errors.push({ field: f.label, reason: `Invalid date "${s}"` }); data[f.key] = d ?? ""; }
      else if (f.kind === "number") { const n = parseNumber(v); if (!Number.isFinite(n) || n < 0) errors.push({ field: f.label, reason: `Invalid amount "${s}"` }); data[f.key] = n; }
      else if (f.kind === "email") { if (!/^\S+@\S+\.\S+$/.test(s)) errors.push({ field: f.label, reason: "Invalid email" }); data[f.key] = s; }
      else data[f.key] = s.slice(0, 500);
    }
    let duplicate: ValidatedRow["duplicate"] = null;
    let dupKey = "";
    if (type === "clients") {
      if (String(data["fullName"] ?? "").length === 1) errors.push({ field: "Full name", reason: "Name is too short" });
      const g = key(String(data["gender"] ?? "")); data["gender"] = (GENDERS as readonly string[]).includes(g) ? g : g === "m" ? "male" : g === "f" ? "female" : "unspecified";
      if (data["dateOfBirth"] && String(data["dateOfBirth"]) > todayISO()) errors.push({ field: "Date of birth", reason: "Date of birth is in the future" });
      const p = String(data["phoneNormalized"] ?? ""); dupKey = p;
      const ex = p ? clientsByPhone.get(p) : undefined;
      if (ex) duplicate = { id: ex.id, label: `${ex.fullName} · ${ex.phone} · ${ex.clientCode}`, incoming: `${data["fullName"]} · ${data["phone"]}` };
    } else if (type === "packages") {
      if (errors.length === 0 && !(Number(data["durationDays"]) >= 1)) errors.push({ field: "Duration", reason: "Duration must be at least 1 day" });
      const c = (PACKAGE_CATEGORIES as readonly string[]).find((x) => key(x) === key(String(data["category"] ?? ""))); data["category"] = c ?? "Custom";
      dupKey = key(String(data["name"] ?? ""));
      const ex = ctx.packages.find((p) => key(p.name) === dupKey);
      if (ex) duplicate = { id: ex.id, label: `${ex.name} · ${ex.durationDays} days · ₹${ex.price}`, incoming: `${data["name"]} · ${data["durationDays"]} days · ₹${data["price"]}` };
    } else if (type === "trainers") {
      const sv = data["shareValue"]; if (typeof sv === "number" && sv > 100) errors.push({ field: "Trainer share %", reason: "Share % must be 0–100" });
      dupKey = String(data["phoneNormalized"] || key(String(data["name"] ?? "")));
      const ex = ctx.trainers.find((t) => (data["phoneNormalized"] && normalizePhone(t.phone) === data["phoneNormalized"]) || key(t.name) === key(String(data["name"] ?? "")));
      if (ex) duplicate = { id: ex.id, label: `${ex.name} · ${ex.phone || "no phone"}`, incoming: `${data["name"]} · ${data["phone"] || "no phone"}` };
    } else if (type === "memberships") {
      const client = clientsByPhone.get(String(data["phoneNormalized"] ?? ""));
      if (data["phoneNormalized"] && !client) errors.push({ field: "Client phone", reason: `No client with phone ${data["phone"]} — import clients first` });
      if (client) { data["clientId"] = client.id; data["clientNameSnapshot"] = client.fullName; }
      const pname = String(data["packageName"] ?? "");
      let pkg = ctx.packages.find((p) => key(p.name) === key(pname)) ?? null;
      const res = pname ? ctx.packageRes[key(pname)] : undefined;
      if (pname && !pkg) {
        if (res?.mode === "map") pkg = ctx.packages.find((p) => p.id === res.id) ?? null;
        else if (res?.mode === "create") { if (!(Number(res.price) >= 0) || !(Number(res.durationDays) >= 1)) errors.push({ field: "Package", reason: `Enter price and duration to create package "${pname}"` }); data["createPackage"] = pname; }
        else if (res?.mode === "skip") errors.push({ field: "Package", reason: `Package "${pname}" skipped by admin` });
        else errors.push({ field: "Package", reason: `Package "${pname}" does not exist` });
      }
      if (pkg) { data["packageId"] = pkg.id; data["packageNameSnapshot"] = pkg.name; }
      else if (data["createPackage"]) data["packageNameSnapshot"] = pname;
      const days = pkg?.durationDays ?? (res?.mode === "create" ? Number(res.durationDays) : 0);
      if (data["startDate"] && !data["endDate"]) { if (days >= 1) { data["endDate"] = addDays(String(data["startDate"]), days - 1); warnings.push("End date calculated from package duration"); } else errors.push({ field: "End date", reason: "Missing end date" }); }
      if (data["startDate"] && data["endDate"] && String(data["endDate"]) < String(data["startDate"])) errors.push({ field: "End date", reason: "End date is before start date" });
      if (data["price"] === null) data["price"] = pkg?.price ?? (res?.mode === "create" ? Number(res.price) : 0);
      const st = key(String(data["status"] ?? ""));
      if (st && !["active", "expired", "cancelled", "inactive"].includes(st)) errors.push({ field: "Status", reason: `Invalid membership status "${data["status"]}"` });
      data["status"] = st === "cancelled" ? "cancelled" : String(data["endDate"] ?? "") < todayISO() ? "expired" : st === "expired" || st === "inactive" ? "expired" : "active";
      const tname = String(data["trainerName"] ?? "");
      if (tname) {
        const t = ctx.trainers.find((x) => key(x.name) === key(tname)); const tr = ctx.trainerRes[key(tname)];
        if (t) { data["trainerId"] = t.id; data["trainerNameSnapshot"] = t.name; }
        else if (tr?.mode === "map") { const m = ctx.trainers.find((x) => x.id === tr.id); if (m) { data["trainerId"] = m.id; data["trainerNameSnapshot"] = m.name; } }
        else if (tr?.mode === "create") { data["createTrainer"] = tname; data["trainerNameSnapshot"] = tname; }
        else warnings.push(`Trainer "${tname}" does not exist — trainer assignment skipped`);
      }
      dupKey = `${data["clientId"]}|${data["packageNameSnapshot"]}|${data["startDate"]}|${data["endDate"]}`;
      const ex = ctx.memberships.find((m) => m.clientId === data["clientId"] && key(m.packageNameSnapshot) === key(String(data["packageNameSnapshot"] ?? "")) && m.startDate === data["startDate"] && m.endDate === data["endDate"]);
      if (ex) duplicate = { id: ex.id, label: `${ex.packageNameSnapshot} · ${ex.startDate} → ${ex.endDate} (${ex.status})`, incoming: `${data["packageNameSnapshot"]} · ${data["startDate"]} → ${data["endDate"]}` };
    } else if (type === "expenses") {
      const c = (EXPENSE_CATEGORIES as readonly string[]).find((x) => key(x) === key(String(data["category"] ?? ""))); data["category"] = c ?? "Other";
      const m = (EXPENSE_PAYMENT_METHODS as readonly string[]).find((x) => key(x) === key(String(data["paymentMethod"] ?? ""))); data["paymentMethod"] = m ?? "Other";
      if (data["amount"] === 0) errors.push({ field: "Amount", reason: "Amount must be greater than zero" });
      dupKey = `${key(String(data["title"]))}|${data["date"]}|${data["amount"]}`;
      const ex = ctx.expenses.find((e) => key(e.title) === key(String(data["title"])) && e.date === data["date"] && e.amount === data["amount"]);
      if (ex) duplicate = { id: ex.id, label: `${ex.title} · ${ex.date} · ₹${ex.amount}`, incoming: `${data["title"]} · ${data["date"]} · ₹${data["amount"]}` };
    }
    if (dupKey && errors.length === 0) {
      const first = seen.get(dupKey);
      if (first !== undefined && !duplicate) duplicate = { id: "", label: `Same as row ${first} in this file`, incoming: "" };
      else if (first === undefined) seen.set(dupKey, row);
    }
    const canUpdate = type !== "memberships" && type !== "expenses" && !!duplicate?.id;
    let action: ValidatedRow["action"] = "create";
    if (duplicate) { const a = ctx.dupActions[row] ?? "skip"; action = a === "update" && !canUpdate ? "skip" : a; }
    return { row, raw, data, errors, warnings, duplicate, action };
  });
}

/** CSV with Row, Field, Reason, Error, Original Row. */
export function errorReportCsv(items: { row: number; raw: RawRow; field: string; reason: string }[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Row", "Field", "Reason", "Error", "Original Row"].map(esc).join(",")];
  for (const i of items) lines.push([i.row, i.field, i.reason, `Row ${i.row}: ${i.reason}`, JSON.stringify(i.raw)].map(esc).join(","));
  return lines.join("\n");
}

export function downloadText(name: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
