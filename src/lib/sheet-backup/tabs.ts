/**
 * The readable tabs of the backup sheet besides the month registers: Members, Dues, Expenses,
 * All plans, Staff & trainers, Packages and the Read me page. Each builder returns
 * `{ columns, rows, total? }`; the server writes a totals line in row 1, the header in row 2 and the rows from
 * row 3, so a column that needs its own sheet row number (a live formula) uses `i + 3`.
 *
 * Pure (no database): the server reads Firestore and hands plain shapes in.
 */
import { CATEGORY_LABEL } from "./month.ts";
import type { BillIn, Cell, ClientIn, Column, PackageIn, PlanIn, PtIn } from "./types.ts";

export interface TabData<R> {
  columns: Column<R>[];
  rows: R[];
  total?: number;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
/** Sheet row of data row `i` (row 1 = totals line, row 2 = header). */
const sheetRow = (i: number) => i + 3;
const DAY_MS = 86_400_000;
/** b − a in whole days for two YYYY-MM-DD strings. */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const yesNo = (v: boolean | undefined) => (v ? "Yes" : "No");
/** A bill that is still asked for: not refunded, not closed (its plan was cancelled), money due. */
const isOpenBill = (b: BillIn) =>
  b.balanceDue > 0 && b.paymentStatus !== "closed" && b.paymentStatus !== "refunded";

/* ------------------------------------------------------------------ Members */

export interface MemberIn extends ClientIn {
  gender?: string | undefined;
  dateOfBirth?: string | null | undefined;
  joinedOn?: string | undefined;
  lastVisitDate?: string | undefined;
  status: string;
  currentMembership: {
    packageName: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
}

export interface MemberRow {
  id: string;
  name: string;
  phone: string;
  gender: string;
  dob: string;
  joined: string;
  plan: string;
  start: string;
  end: string;
  status: string;
  trainer: string;
  ptEnd: string;
  balance: number | "";
  lastVisit: string;
}

/**
 * Active / Ending in 7 days / Ended / No plan, from the gym plan's dates and today. A member with no
 * running gym plan but a running PT plan (PT-only members) is "PT only", not "No plan" or "Ended".
 */
export function memberStatus(m: MemberIn["currentMembership"], today: string, ptEnd = ""): string {
  const gym = !m
    ? "No plan"
    : m.status === "cancelled" || m.status === "expired" || m.endDate < today
      ? "Ended"
      : daysBetween(today, m.endDate) <= 7
        ? "Ending in 7 days"
        : "Active";
  return (gym === "No plan" || gym === "Ended") && ptEnd >= today ? "PT only" : gym;
}

/** Members top line: "326 members · 210 active · 4 ending in 7 days · 3 PT only · 99 ended · updated …". */
export function membersLine(rows: { status: string }[], stamp: string): string {
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  const parts = [
    `${rows.length} member${rows.length === 1 ? "" : "s"}`,
    `${n("Active")} active`,
    `${n("Ending in 7 days")} ending in 7 days`,
    ...(n("PT only") ? [`${n("PT only")} PT only`] : []),
    `${n("Ended")} ended`,
    ...(n("No plan") ? [`${n("No plan")} no plan`] : []),
  ];
  return `${parts.join(" · ")} · updated ${stamp}`;
}

export function membersTab(input: {
  clients: MemberIn[];
  pts: PtIn[];
  openBills: BillIn[];
  today: string;
}): TabData<MemberRow> {
  const owed = new Map<string, number>();
  for (const b of input.openBills)
    if (isOpenBill(b)) owed.set(b.clientId, round((owed.get(b.clientId) ?? 0) + b.balanceDue));
  // The PT the member is on now: not cancelled, the one that ends last.
  const ptOf = (clientId: string) =>
    input.pts
      .filter((p) => p.clientId === clientId && p.status !== "cancelled")
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const gender = (g: string | undefined) =>
    !g || g === "unspecified" ? "" : g.charAt(0).toUpperCase() + g.slice(1);

  const rows: MemberRow[] = [...input.clients]
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }))
    .map((c) => {
      const m = c.currentMembership;
      const p = ptOf(c.id);
      const due = owed.get(c.id) ?? 0;
      return {
        id: c.clientCode,
        name: c.fullName,
        phone: c.phone,
        gender: gender(c.gender),
        dob: c.dateOfBirth ?? "",
        joined: c.joinedOn ?? "",
        plan: m?.packageName ?? "",
        start: m?.startDate ?? "",
        end: m?.endDate ?? "",
        status: memberStatus(m, input.today, p?.endDate ?? ""),
        trainer: p?.trainerNameSnapshot ?? "",
        ptEnd: p?.endDate ?? "",
        balance: due > 0 ? due : "",
        lastVisit: c.lastVisitDate ?? "",
      };
    });

  const columns: Column<MemberRow>[] = [
    { header: "MEMBER ID", value: (r) => r.id, width: 100, kind: "text" },
    { header: "NAME", value: (r) => r.name, width: 170, kind: "text" },
    { header: "PHONE NO", value: (r) => r.phone, width: 110, kind: "text" },
    { header: "GENDER", value: (r) => r.gender, width: 80, kind: "text" },
    { header: "DATE OF BIRTH", value: (r) => r.dob, width: 96, kind: "date" },
    { header: "JOINED", value: (r) => r.joined, width: 96, kind: "date" },
    { header: "CURRENT PLAN", value: (r) => r.plan, width: 210, kind: "text" },
    { header: "START DATE", value: (r) => r.start, width: 96, kind: "date" },
    { header: "ENDING DATE", value: (r) => r.end, width: 96, kind: "date" },
    // Live in the sheet (vs TODAY()), so it stays right even if the app is down. ENDING DATE is column I.
    {
      header: "DAYS LEFT",
      value: (_r, i) => `=IF(I${sheetRow(i)}="","",MAX(0,I${sheetRow(i)}-TODAY()))`,
      width: 80,
      kind: "number",
    },
    { header: "STATUS", value: (r) => r.status, width: 130, kind: "text" },
    { header: "PT TRAINER", value: (r) => r.trainer, width: 120, kind: "text" },
    { header: "PT END", value: (r) => r.ptEnd, width: 96, kind: "date" },
    {
      header: "BALANCE DUE",
      value: (r) => r.balance,
      width: 100,
      kind: "money",
      money: "sum",
      color: "#B71C1C",
    },
    { header: "LAST VISIT", value: (r) => r.lastVisit, width: 96, kind: "date" },
  ];
  return { columns, rows };
}

/* --------------------------------------------------------------------- Dues */

export interface DueRow {
  name: string;
  phone: string;
  billNo: string;
  billDate: string;
  totalBill: number;
  paid: number;
  due: number;
  payBy: string;
  id: string;
}

export function duesTab(input: {
  openBills: BillIn[];
  clients: Map<string, ClientIn>;
  today: string;
}): TabData<DueRow> {
  const bills = input.openBills.filter(isOpenBill);
  // Most overdue first; bills with no pay-by date last.
  bills.sort(
    (a, b) =>
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
      a.invoiceDate.localeCompare(b.invoiceDate) ||
      a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true }),
  );
  const rows: DueRow[] = bills.map((b) => {
    const c = input.clients.get(b.clientId);
    return {
      name: c?.fullName ?? b.clientNameSnapshot,
      phone: c?.phone ?? "",
      billNo: b.invoiceNumber,
      billDate: b.invoiceDate,
      totalBill: b.total,
      paid: b.amountPaid,
      due: b.balanceDue,
      payBy: b.dueDate,
      id: c?.clientCode ?? "",
    };
  });
  const columns: Column<DueRow>[] = [
    { header: "NAME", value: (r) => r.name, width: 170, kind: "text" },
    { header: "PHONE NO", value: (r) => r.phone, width: 110, kind: "text" },
    { header: "BILL NO", value: (r) => r.billNo, width: 100, kind: "text" },
    { header: "BILL DATE", value: (r) => r.billDate, width: 96, kind: "date" },
    { header: "TOTAL BILL", value: (r) => r.totalBill, width: 100, kind: "money", money: "sum" },
    { header: "PAID", value: (r) => r.paid, width: 96, kind: "money", money: "sum" },
    {
      header: "DUE",
      value: (r) => r.due,
      width: 96,
      kind: "money",
      money: "sum",
      color: "#B71C1C",
    },
    { header: "PAY BY", value: (r) => r.payBy, width: 96, kind: "date" },
    // Live: counts up every day without a new sync. PAY BY is column H.
    {
      header: "DAYS OVERDUE",
      value: (_r, i) =>
        `=IF(H${sheetRow(i)}="","",IF(TODAY()>H${sheetRow(i)},TODAY()-H${sheetRow(i)},""))`,
      width: 100,
      kind: "number",
    },
    { header: "MEMBER ID", value: (r) => r.id, width: 100, kind: "text" },
  ];
  // The dashboard "Balance due" tile sums the balanceDue of these same bills.
  return { columns, rows, total: round(rows.reduce((s, r) => s + r.due, 0)) };
}

/* ----------------------------------------------------------------- Expenses */

export interface ExpenseIn {
  date: string;
  category: string;
  amount: number;
  paymentMethod?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  notes?: string | undefined;
  createdBy?: string | undefined;
}

export interface ExpenseRow {
  date: string;
  category: string;
  amount: number;
  mode: string;
  note: string;
  by: string;
}

export function expensesTab(input: { expenses: ExpenseIn[] }): TabData<ExpenseRow> {
  const rows: ExpenseRow[] = [...input.expenses]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      date: e.date,
      category: e.category,
      amount: e.amount,
      mode: e.paymentMethod ?? "",
      // What it was for: the title, then the description and notes when they say something more.
      note: [
        ...new Set([e.title, e.description, e.notes].map((t) => (t ?? "").trim()).filter(Boolean)),
      ].join(" · "),
      by: e.createdBy ?? "",
    }));
  const columns: Column<ExpenseRow>[] = [
    { header: "DATE", value: (r) => r.date, width: 96, kind: "date" },
    { header: "CATEGORY", value: (r) => r.category, width: 140, kind: "text" },
    { header: "AMOUNT", value: (r) => r.amount, width: 100, kind: "money", money: "sum" },
    { header: "MODE", value: (r) => r.mode, width: 110, kind: "text" },
    { header: "NOTE", value: (r) => r.note, width: 300, kind: "text" },
    { header: "ADDED BY", value: (r) => r.by, width: 130, kind: "text" },
  ];
  return { columns, rows, total: round(rows.reduce((s, r) => s + r.amount, 0)) };
}

/* ---------------------------------------------------------------- All plans */

export interface PlanRow {
  id: string;
  name: string;
  kind: "Gym" | "PT";
  pkg: string;
  start: string;
  end: string;
  price: number;
  status: string;
  who: string;
  billNo: string;
  oldSoftware: string;
}

export function plansTab(input: {
  plans: PlanIn[];
  pts: PtIn[];
  clients: Map<string, ClientIn>;
  /** Bills by id; each plan finds its own by invoiceId. */
  bills: Map<string, BillIn>;
}): TabData<PlanRow> {
  const who = (clientId: string) => input.clients.get(clientId);
  const billNo = (invoiceId: string | undefined) =>
    invoiceId ? (input.bills.get(invoiceId)?.invoiceNumber ?? "") : "";
  const rows: PlanRow[] = [
    ...input.plans.map((p) => ({
      id: who(p.clientId)?.clientCode ?? "",
      name: who(p.clientId)?.fullName ?? "",
      kind: "Gym" as const,
      pkg: p.packageNameSnapshot,
      start: p.startDate,
      end: p.endDate,
      price: p.priceSnapshot,
      status: p.status,
      who: p.counsellorName,
      billNo: billNo(p.invoiceId),
      oldSoftware: p.paidInOldSoftware ? "Yes" : "",
    })),
    ...input.pts.map((p) => ({
      id: who(p.clientId)?.clientCode ?? "",
      name: who(p.clientId)?.fullName ?? "",
      kind: "PT" as const,
      pkg: p.ptPackageNameSnapshot,
      start: p.startDate,
      end: p.endDate,
      price: p.ptPrice,
      status: p.status,
      who: p.trainerNameSnapshot,
      billNo: billNo(p.invoiceId),
      oldSoftware: p.paidInOldSoftware ? "Yes" : "",
    })),
  ].sort((a, b) => b.start.localeCompare(a.start));
  const columns: Column<PlanRow>[] = [
    { header: "MEMBER ID", value: (r) => r.id, width: 100, kind: "text" },
    { header: "NAME", value: (r) => r.name, width: 170, kind: "text" },
    { header: "KIND", value: (r) => r.kind, width: 70, kind: "text" },
    { header: "PACKAGE", value: (r) => r.pkg, width: 210, kind: "text" },
    { header: "START DATE", value: (r) => r.start, width: 96, kind: "date" },
    { header: "ENDING DATE", value: (r) => r.end, width: 96, kind: "date" },
    { header: "PRICE", value: (r) => r.price, width: 96, kind: "money" },
    { header: "STATUS", value: (r) => r.status, width: 110, kind: "text" },
    { header: "COUNSELLER / TRAINER", value: (r) => r.who, width: 140, kind: "text" },
    { header: "BILL NO", value: (r) => r.billNo, width: 100, kind: "text" },
    { header: "FROM OLD SOFTWARE", value: (r) => r.oldSoftware, width: 110, kind: "text" },
  ];
  return { columns, rows };
}

/* -------------------------------------------------------- Staff & trainers */

export interface StaffRow {
  name: string;
  role: string;
  phone: string;
  active: string;
}

/** Names, roles and phones only: pay, logins and biometric ids never go in the sheet. */
export function staffTab(input: {
  staff: {
    id?: string | undefined;
    name: string;
    role?: string | undefined;
    phone?: string | undefined;
    active?: boolean | undefined;
  }[];
  trainers: {
    name: string;
    phone?: string | undefined;
    status?: string | undefined;
    active?: boolean | undefined;
    isActive?: boolean | undefined;
    /** The trainer's Staff record: already listed above when set. */
    staffId?: string | undefined;
  }[];
}): TabData<StaffRow> {
  const staffIds = new Set(input.staff.map((s) => s.id).filter(Boolean));
  const rows: StaffRow[] = [
    ...input.staff.map((s) => ({
      name: s.name,
      role: s.role ?? "",
      phone: s.phone ?? "",
      active: yesNo(s.active),
    })),
    ...input.trainers
      .filter((t) => !(t.staffId && staffIds.has(t.staffId)))
      .map((t) => ({
        name: t.name,
        role: "Trainer",
        phone: t.phone ?? "",
        active: yesNo(t.status ? t.status === "active" : (t.active ?? t.isActive)),
      })),
  ];
  const columns: Column<StaffRow>[] = [
    { header: "NAME", value: (r) => r.name, width: 170, kind: "text" },
    { header: "ROLE", value: (r) => r.role, width: 140, kind: "text" },
    { header: "PHONE NO", value: (r) => r.phone, width: 110, kind: "text" },
    { header: "ACTIVE", value: (r) => r.active, width: 80, kind: "text" },
  ];
  return { columns, rows };
}

/* ----------------------------------------------------------------- Packages */

export interface PackageRow {
  name: string;
  kind: "Gym" | "PT";
  category: string;
  days: number | "";
  price: number;
  active: string;
}

export function packagesTab(input: {
  packages: PackageIn[];
  ptPackages: {
    name: string;
    price: number;
    durationDays?: number | undefined;
    schedule?: string | undefined;
    isActive?: boolean | undefined;
  }[];
}): TabData<PackageRow> {
  const rows: PackageRow[] = [
    ...input.packages.map((p) => ({
      name: p.name,
      kind: "Gym" as const,
      category: CATEGORY_LABEL[p.category] ?? p.category,
      days: p.durationDays,
      price: p.price,
      active: yesNo(p.isActive),
    })),
    ...input.ptPackages.map((p) => ({
      name: p.name,
      kind: "PT" as const,
      category: p.schedule ? `Personal training (${p.schedule})` : "Personal training",
      days: p.durationDays ?? ("" as const),
      price: p.price,
      active: yesNo(p.isActive),
    })),
  ];
  const columns: Column<PackageRow>[] = [
    { header: "NAME", value: (r) => r.name, width: 170, kind: "text" },
    { header: "KIND", value: (r) => r.kind, width: 70, kind: "text" },
    { header: "CATEGORY", value: (r) => r.category, width: 190, kind: "text" },
    { header: "DAYS", value: (r) => r.days, width: 70, kind: "number" },
    { header: "PRICE", value: (r) => r.price, width: 96, kind: "money" },
    { header: "ACTIVE", value: (r) => r.active, width: 80, kind: "text" },
  ];
  return { columns, rows };
}

/* ------------------------------------------------------------------ Read me */

const TAB_HELP: Record<string, string> = {
  Members: "everyone, their plan and days left. Use this to check entry if the app is down.",
  Dues: "bills with money still to collect, most overdue first. The total is the app's Balance due.",
  Expenses: "money the gym spent, newest first.",
  "All plans": "every gym and personal-training plan ever sold, newest first.",
  "Staff & trainers": "names, roles and phone numbers (no pay or passwords).",
  Packages: "the gym and PT packages and their prices.",
};
const MONTH_TAB = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;
const MONTH_HELP =
  "Every payment taken in the month, one row per payment, on the day it was paid. The top line says if it matches the app.";

/** Plain-English guide, one line per tab, then the health checks, then what to do if the app is down. */
export function readMeRows(input: {
  updatedAt: string;
  checks: { name: string; ok: boolean; detail: string }[];
  tabs: string[];
}): Cell[][] {
  const rows: Cell[][] = [
    ["REBUILD FITNESS — Backup"],
    [`Last updated: ${input.updatedAt}`],
    [""],
    ["Tab", "What it shows / when to use it"],
  ];
  // The month tabs share one line ("Oct 2026 … Aug 2025") instead of the same sentence 14 times.
  const months = input.tabs.filter((t) => MONTH_TAB.test(t));
  let monthsListed = false;
  for (const t of input.tabs) {
    if (t === "Read me" || t.startsWith("_data_")) continue;
    if (MONTH_TAB.test(t)) {
      if (monthsListed) continue;
      monthsListed = true;
      const span = months.length > 1 ? `${months[0]} … ${months[months.length - 1]}` : t;
      rows.push([`Month tabs (${span})`, MONTH_HELP]);
      continue;
    }
    rows.push([t, TAB_HELP[t] ?? ""]);
  }
  if (input.tabs.some((t) => t.startsWith("_data_")))
    rows.push([
      "(hidden tabs)",
      "A full copy of every record, used only to rebuild the app. Do not edit them.",
    ]);
  rows.push([""], ["Checks (does this sheet match the app?)"]);
  if (!input.checks.length) rows.push(["No checks have run yet."]);
  for (const c of input.checks)
    rows.push([
      c.ok
        ? `✓ ${c.name} matches the app (${c.detail})`
        : `✗ ${c.name} does NOT match the app (${c.detail})`,
    ]);
  rows.push(
    [""],
    ["If the app is down"],
    // Step number in A, the words in B (B wraps), so long lines are never cut off.
    ["Step 1", "Open Members to check a member's plan and days left."],
    ["Step 2", "Write new sales and payments on paper (name, phone, plan, amount, cash/UPI/card)."],
    [
      "Step 3",
      "When the app is back, enter them there. The app is the truth; this sheet is only a copy and updates itself.",
    ],
  );
  return rows;
}

/** Which Read me rows are checks (0-based row index) and whether each passed, for colouring. */
export function readMeCheckRows(rows: Cell[][]): { row: number; ok: boolean }[] {
  const out: { row: number; ok: boolean }[] = [];
  rows.forEach((r, row) => {
    const first = String(r[0] ?? "");
    if (first.startsWith("✓")) out.push({ row, ok: true });
    else if (first.startsWith("✗")) out.push({ row, ok: false });
  });
  return out;
}

/** Where the table header and the section headings sit (0-based rows), for readMeFormatRequests. */
export function readMeLayout(rows: Cell[][]): { tableHeaderRow: number; headingRows: number[] } {
  const tableHeaderRow = Math.max(
    0,
    rows.findIndex((r) => r[0] === "Tab" && r.length > 1),
  );
  const headingRows: number[] = [];
  rows.forEach((r, row) => {
    const first = String(r[0] ?? "");
    if (r.length === 1 && (first.startsWith("Checks") || first === "If the app is down"))
      headingRows.push(row);
  });
  return { tableHeaderRow, headingRows };
}
