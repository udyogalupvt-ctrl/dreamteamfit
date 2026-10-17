/**
 * The Google Sheet backup (docs/superpowers/specs/2026-10-13-sheet-backup-design.md).
 *
 * A run is a queue of named steps ("month:2026-10", "members", "data:payments"...). It does as many
 * as fit in its time budget and saves the rest, so the next call continues. One run at a time (a
 * lease in the state doc); a call that finds a run going only leaves a note of what changed.
 *
 *   POST /api/backup/sheet/touch     staff: { paths } these docs changed (quick sync; never fails the sale)
 *   GET  /api/backup/sheet/status    owner: last result, checks, how many steps are left
 *   POST /api/backup/sheet/sync      owner: { mode?: "full" } run up to 40 s; call again until { done: true }
 *   POST /api/backup/sheet/settings  owner: { sheetUrl } use another sheet (tested before it is saved)
 *
 * The app is the truth and never reads the sheet. State and the sheet id live in
 * serverSecrets/sheetBackup (server only). Secrets and logs are never copied (EXCLUDED_COLLECTIONS).
 */
import { createHash } from "node:crypto";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { isOwnerEmail } from "@/constants/owners";
import {
  duesRules,
  membersStatusRules,
  monthRowRules,
  readMeFormatRequests,
  spreadsheetSetupRequests,
  tabFormatRequests,
  toCells,
  type RowRule,
  type StatusRule,
  type TabSpec,
} from "@/lib/sheet-backup/format";
import { buildMonth, MONTH_COLUMNS, type MonthInput } from "@/lib/sheet-backup/month";
import { mergeQueue, stepsFor, tabOrder, type Mode } from "@/lib/sheet-backup/plan";
import { EXCLUDED_COLLECTIONS, recordToRow } from "@/lib/sheet-backup/restore-codec";
import {
  duesTab,
  expensesTab,
  membersLine,
  membersTab,
  packagesTab,
  plansTab,
  readMeCheckRows,
  readMeLayout,
  readMeRows,
  staffTab,
  type ExpenseIn,
  type MemberIn,
} from "@/lib/sheet-backup/tabs";
import {
  emptyMoneyColumns,
  inr,
  istStamp,
  monthFromTitle,
  monthOf,
  monthRange,
  monthTitle,
  monthTotalsLine,
  prevMonth,
  totalsRow,
} from "@/lib/sheet-backup/totals-line";
import type {
  BillIn,
  Cell,
  ClientIn,
  Column,
  PackageIn,
  PayIn,
  PlanIn,
  PtIn,
} from "@/lib/sheet-backup/types";
import { credentials, db, json, localDate, requireStaff } from "./admin";
import { sheetsClient, type SheetsClient } from "./sheets-api";

export const DEFAULT_SHEET_ID = "1Rsn0jB8HX8TsbYmrxeT6VCPl4wcmyh2VhU7yy2_qJxc";

export interface BackupState {
  sheetId: string;
  lastOkAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  checks: { name: string; ok: boolean; detail: string }[];
  queue: string[];
  dirtyMonths: string[];
  dirtyDocs: string[];
  leaseUntil: number;
  restoreSince: string | null;
  /** Fingerprint of each restore tab as last written, so an unchanged collection is not rewritten every night. */
  dataHash?: Record<string, { h: string; at: number }>;
}

const STATE_PATH = "serverSecrets/sheetBackup";
const LEASE_MS = 55_000;
const MAX_DIRTY_DOCS = 3_000;
/** A restore tab whose records did not change is left alone, but never for longer than this (heals hand edits). */
const HASH_TTL_MS = 3 * 86_400_000;
/** Dates before this are typos, not history: they never start a month-by-month fill. */
const EARLIEST_SANE_MONTH = "2015-01";

const defaults = (): BackupState => ({
  sheetId: DEFAULT_SHEET_ID,
  lastOkAt: null,
  lastRunAt: null,
  lastError: null,
  checks: [],
  queue: [],
  dirtyMonths: [],
  dirtyDocs: [],
  leaseUntil: 0,
  restoreSince: null,
});

const stateRef = () => db().doc(STATE_PATH);
const uniq = <T>(a: T[]) => [...new Set(a)];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function loadState(): Promise<BackupState> {
  return {
    ...defaults(),
    ...((await stateRef().get()).data() as Partial<BackupState> | undefined),
  };
}

/** Takes the lease unless a run holds it; either way the changed months / docs are noted for the next run. */
async function acquire(touched: { months?: string[]; paths?: string[] } | undefined) {
  const ref = stateRef();
  return db().runTransaction(async (tx) => {
    const cur = {
      ...defaults(),
      ...((await tx.get(ref)).data() as Partial<BackupState> | undefined),
    };
    const held = cur.leaseUntil > Date.now();
    const next: BackupState = {
      ...cur,
      dirtyMonths: uniq([...cur.dirtyMonths, ...(touched?.months ?? [])]),
      dirtyDocs: uniq([...cur.dirtyDocs, ...(touched?.paths ?? [])]).slice(-MAX_DIRTY_DOCS),
      leaseUntil: held ? cur.leaseUntil : Date.now() + LEASE_MS,
    };
    tx.set(ref, next);
    return { held, state: next };
  });
}

/* ------------------------------------------------------------- reading data */

type Doc = DocumentData & { id: string };
const docsOf = (s: { docs: { id: string; data(): DocumentData }[] }): Doc[] =>
  s.docs.map((d) => ({ ...d.data(), id: d.id }));
const str = (v: unknown) =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
/** The Indian day a Firestore Timestamp falls on. */
const dayOf = (v: unknown) =>
  v && typeof (v as { toDate?: unknown }).toDate === "function"
    ? localDate((v as { toDate(): Date }).toDate())
    : "";

async function getMany(col: string, ids: (string | null | undefined)[]) {
  const out = new Map<string, Doc>();
  const list = uniq(ids.filter((x): x is string => !!x));
  for (let i = 0; i < list.length; i += 100) {
    const snaps = await db().getAll(
      ...list.slice(i, i + 100).map((id) => db().collection(col).doc(id)),
    );
    for (const s of snaps) if (s.exists) out.set(s.id, { ...s.data()!, id: s.id });
  }
  return out;
}

async function whereIn(col: string, field: string, values: string[]) {
  const out: Doc[] = [];
  const list = uniq(values.filter(Boolean));
  for (let i = 0; i < list.length; i += 30)
    out.push(
      ...docsOf(
        await db()
          .collection(col)
          .where(field, "in", list.slice(i, i + 30))
          .get(),
      ),
    );
  return out;
}

const toPay = (d: Doc): PayIn => ({
  id: d.id,
  clientId: str(d["clientId"]),
  clientNameSnapshot: str(d["clientNameSnapshot"]),
  invoiceId: str(d["invoiceId"]),
  membershipId: strOrNull(d["membershipId"]),
  ptAssignmentId: strOrNull(d["ptAssignmentId"]),
  amount: num(d["amount"]),
  method: str(d["method"]),
  paymentDate: str(d["paymentDate"]),
  kind: (str(d["kind"]) || "initial") as PayIn["kind"],
  counsellorName: str(d["counsellorName"]),
  ...(d["oldSoftware"] ? { oldSoftware: true } : {}),
  ...(d["oldSoftwareBillNo"] ? { oldSoftwareBillNo: str(d["oldSoftwareBillNo"]) } : {}),
  ...(d["splitId"] ? { splitId: str(d["splitId"]) } : {}),
  createdDay: dayOf(d["createdAt"]),
});

const toBill = (d: Doc): BillIn => ({
  id: d.id,
  invoiceNumber: str(d["invoiceNumber"]),
  clientId: str(d["clientId"]),
  clientNameSnapshot: str(d["clientNameSnapshot"]),
  membershipId: strOrNull(d["membershipId"]),
  ptAssignmentId: strOrNull(d["ptAssignmentId"]),
  items: Array.isArray(d["items"])
    ? (d["items"] as { name?: unknown }[]).map((i) => ({ name: str(i?.name) }))
    : [],
  subtotal: num(d["subtotal"]),
  discount: num(d["discount"]),
  total: num(d["total"]),
  amountPaid: num(d["amountPaid"]),
  balanceDue: num(d["balanceDue"]),
  paymentStatus: str(d["paymentStatus"]),
  paymentMethod: str(d["paymentMethod"]),
  invoiceDate: str(d["invoiceDate"]),
  dueDate: str(d["dueDate"]),
  membershipGross: num(d["membershipGross"]),
  ptGross: num(d["ptGross"]),
  ...(d["upgradeCredit"] ? { upgradeCredit: num(d["upgradeCredit"]) } : {}),
  ...(d["oldSoftwareCredit"] ? { oldSoftwareCredit: num(d["oldSoftwareCredit"]) } : {}),
  cancelledParts: (d["cancelledParts"] as BillIn["cancelledParts"]) ?? null,
  paymentsTracked: d["paymentsTracked"] === true,
  counsellorName: str(d["counsellorName"]),
  createdDay: dayOf(d["createdAt"]),
});

const toPlan = (d: Doc): PlanIn => ({
  id: d.id,
  clientId: str(d["clientId"]),
  packageId: str(d["packageId"]),
  packageNameSnapshot: str(d["packageNameSnapshot"]),
  priceSnapshot: num(d["priceSnapshot"]),
  durationDaysSnapshot: num(d["durationDaysSnapshot"]),
  startDate: str(d["startDate"]),
  endDate: str(d["endDate"]),
  status: str(d["status"]),
  counsellorName: str(d["counsellorName"]),
  ...(d["invoiceId"] ? { invoiceId: str(d["invoiceId"]) } : {}),
  ...(d["paidInOldSoftware"] ? { paidInOldSoftware: true } : {}),
  ...(d["oldSoftwarePaid"] ? { oldSoftwarePaid: num(d["oldSoftwarePaid"]) } : {}),
  ...(d["oldSoftwareBalance"] ? { oldSoftwareBalance: num(d["oldSoftwareBalance"]) } : {}),
});

const toPt = (d: Doc): PtIn => ({
  id: d.id,
  clientId: str(d["clientId"]),
  ptPackageNameSnapshot: str(d["ptPackageNameSnapshot"]),
  trainerNameSnapshot: str(d["trainerNameSnapshot"]),
  startDate: str(d["startDate"]),
  endDate: str(d["endDate"]),
  status: str(d["status"]),
  ptPrice: num(d["ptPrice"]),
  ...(d["invoiceId"] ? { invoiceId: str(d["invoiceId"]) } : {}),
  ...(d["paidInOldSoftware"] ? { paidInOldSoftware: true } : {}),
  ...(d["oldSoftwarePaid"] ? { oldSoftwarePaid: num(d["oldSoftwarePaid"]) } : {}),
});

const toClient = (d: Doc): ClientIn => ({
  id: d.id,
  clientCode: str(d["clientCode"]),
  fullName: str(d["fullName"]),
  phone: str(d["phone"]),
});

const toMember = (d: Doc): MemberIn => {
  const m = d["currentMembership"] as Record<string, unknown> | null | undefined;
  return {
    ...toClient(d),
    gender: str(d["gender"]),
    dateOfBirth: strOrNull(d["dateOfBirth"]),
    joinedOn: str(d["joinedOn"]) || dayOf(d["createdAt"]),
    lastVisitDate: str(d["lastVisitDate"]),
    status: str(d["status"]),
    currentMembership: m
      ? {
          packageName: str(m["packageName"]),
          startDate: str(m["startDate"]),
          endDate: str(m["endDate"]),
          status: str(m["status"]),
        }
      : null,
  };
};

const toPackage = (d: Doc): PackageIn => ({
  id: d.id,
  name: str(d["name"]),
  category: str(d["category"]),
  durationDays: num(d["durationDays"]),
  price: num(d["price"]),
  isActive: d["isActive"] !== false,
});

/* ------------------------------------------------------------------ the run */

interface Ctx {
  client: SheetsClient;
  today: string;
  mode: Mode;
  state: BackupState;
  checks: BackupState["checks"];
  /** Read once per run and shared by the steps that need them. */
  memo: { packages?: Map<string, PackageIn>; openBills?: BillIn[] };
}

const stamp = () => `${istStamp(new Date())}`;

function setCheck(ctx: Ctx, c: BackupState["checks"][number]) {
  ctx.checks = [...ctx.checks.filter((x) => x.name !== c.name), c];
}

async function packagesOf(ctx: Ctx) {
  return (ctx.memo.packages ??= new Map(
    docsOf(await db().collection("packages").get()).map((d) => [d.id, toPackage(d)]),
  ));
}

/** Bills with money still due (the dashboard's "Balance due" tile reads these). */
async function openBillsOf(ctx: Ctx) {
  return (ctx.memo.openBills ??= docsOf(
    await db().collection("invoices").where("balanceDue", ">", 0).get(),
  ).map(toBill));
}

/** Writes one readable tab: the top line, the header, the rows, then the whole Look. */
async function publishTab<R>(
  ctx: Ctx,
  title: string,
  tab: { columns: Column<R>[]; rows: R[] },
  o: {
    color: string;
    line: string;
    due?: number;
    statusRules?: StatusRule[];
    rowRules?: RowRule[];
  },
) {
  const { client } = ctx;
  const sheetId = await client.ensureTab(title);
  const values: Cell[][] = [
    totalsRow(tab.columns, o.line, o.due ?? 0),
    tab.columns.map((c) => c.header),
    ...toCells(tab.columns, tab.rows),
  ];
  // Formula columns (days left, days overdue) are the ones whose first row starts with "=".
  const first = tab.rows[0];
  const formulaCols = tab.columns.flatMap((c, i) => {
    const v = first === undefined ? "" : c.value(first, 0);
    return typeof v === "string" && v.startsWith("=") ? [i] : [];
  });
  await client.writeTab(title, values, { formulaRows: [0], formulaCols });
  const info = (await client.meta()).tabs.find((t) => t.title === title);
  const spec: TabSpec = {
    sheetId,
    columns: tab.columns as Column<unknown>[],
    rowCount: tab.rows.length,
    hasTotals: true,
    tabColor: o.color,
    existingBandingIds: info?.bandingIds ?? [],
    existingConditionalCount: info?.conditionalFormatCount ?? 0,
    hideEmptyMoney: emptyMoneyColumns(tab.columns, tab.rows),
    ...(o.statusRules ? { statusRules: o.statusRules } : {}),
    ...(o.rowRules ? { rowRules: o.rowRules } : {}),
  };
  await client.batchUpdate(tabFormatRequests(spec));
}

async function monthStep(ctx: Ctx, ym: string) {
  const { from, to } = monthRange(ym, ctx.today);
  const title = monthTitle(ym);
  const [paySnap, invSnap] = await Promise.all([
    db()
      .collection("payments")
      .where("paymentDate", ">=", from)
      .where("paymentDate", "<=", to)
      .get(),
    db()
      .collection("invoices")
      .where("invoiceDate", ">=", from)
      .where("invoiceDate", "<=", to)
      .get(),
  ]);
  const payments = docsOf(paySnap).map(toPay);
  // Old bills with no payment records count on their bill date (the dashboard's rule).
  const legacyBills = docsOf(invSnap)
    .map(toBill)
    .filter((b) => !b.paymentsTracked && b.amountPaid > 0);
  // Sales with ₹0 paid that day have no "initial" payment, so no payment row carries their bill.
  const hasFirst = new Set(payments.filter((p) => p.kind === "initial").map((p) => p.invoiceId));
  const maybeUnpaid = docsOf(invSnap)
    .map(toBill)
    .filter((b) => b.paymentsTracked && b.total > 0 && !hasFirst.has(b.id));
  for (const p of (
    await whereIn(
      "payments",
      "invoiceId",
      maybeUnpaid.map((b) => b.id),
    )
  ).map(toPay))
    if (p.kind === "initial") hasFirst.add(p.invoiceId);
  const unpaidSales = maybeUnpaid.filter((b) => !hasFirst.has(b.id));
  const billDocs = await getMany(
    "invoices",
    payments.map((p) => p.invoiceId),
  );
  const bills = new Map([...billDocs].map(([id, d]) => [id, toBill(d)]));
  for (const b of [...legacyBills, ...unpaidSales]) bills.set(b.id, b);
  const planDocs = await getMany("memberships", [
    ...payments.map((p) => p.membershipId),
    ...[...bills.values()].map((b) => b.membershipId),
  ]);
  const ptDocs = await getMany("ptAssignments", [
    ...payments.map((p) => p.ptAssignmentId),
    ...[...bills.values()].map((b) => b.ptAssignmentId),
  ]);
  const clientIds = [
    ...payments.map((p) => p.clientId),
    ...[...legacyBills, ...unpaidSales].map((b) => b.clientId),
  ];
  const clientDocs = await getMany("clients", clientIds);
  const theirPlans = (await whereIn("memberships", "clientId", clientIds)).map(toPlan);

  const input: MonthInput = {
    from,
    to,
    payments,
    legacyBills,
    unpaidSales,
    bills,
    plans: new Map([...planDocs].map(([id, d]) => [id, toPlan(d)])),
    pts: new Map([...ptDocs].map(([id, d]) => [id, toPt(d)])),
    clients: new Map([...clientDocs].map(([id, d]) => [id, toClient(d)])),
    packages: await packagesOf(ctx),
    plansOfClients: theirPlans,
  };
  const out = buildMonth(input);
  // A month with nothing in it and no tab yet is not worth a tab.
  if (!out.rows.length && !(await ctx.client.meta()).tabs.some((t) => t.title === title)) return;

  await publishTab(
    ctx,
    title,
    { columns: MONTH_COLUMNS, rows: out.rows },
    {
      color: "#6A1B9A",
      line: monthTotalsLine({
        count: out.rows.length,
        appTotal: out.appTotal,
        matches: out.matches,
        stamp: stamp(),
      }),
      due: out.dueOnBills,
      rowRules: monthRowRules(MONTH_COLUMNS as Column<unknown>[]),
    },
  );
  setCheck(ctx, {
    name: title,
    ok: out.matches,
    detail: out.matches
      ? inr(out.appTotal)
      : `app ${inr(out.appTotal)}, sheet ${inr(out.sheetTotal)}`,
  });
}

async function clientMap(ids: string[]) {
  const docs = await getMany("clients", ids);
  return new Map([...docs].map(([id, d]) => [id, toClient(d)]));
}

async function duesStep(ctx: Ctx) {
  const open = await openBillsOf(ctx);
  const clients = await clientMap(open.map((b) => b.clientId));
  const tab = duesTab({ openBills: open, clients, today: ctx.today });
  // The dashboard tile: every bill with money due that is not refunded.
  const appDue = round2(
    open.filter((b) => b.paymentStatus !== "refunded").reduce((s, b) => s + b.balanceDue, 0),
  );
  const ok = Math.abs(appDue - (tab.total ?? 0)) < 0.01;
  await publishTab(ctx, "Dues", tab, {
    color: "#C62828",
    line: `${tab.rows.length} open bills · app shows ${inr(appDue)} ${ok ? "✓ matches" : "✗ DIFFERENT"} · updated ${stamp()}`,
    statusRules: duesRules,
  });
  setCheck(ctx, {
    name: "Dues",
    ok,
    detail: ok ? inr(appDue) : `app ${inr(appDue)}, sheet ${inr(tab.total ?? 0)}`,
  });
}

async function membersStep(ctx: Ctx) {
  const [clients, pts, open] = await Promise.all([
    db().collection("clients").get(),
    db().collection("ptAssignments").get(),
    openBillsOf(ctx),
  ]);
  const tab = membersTab({
    clients: docsOf(clients).map(toMember),
    pts: docsOf(pts).map(toPt),
    openBills: open,
    today: ctx.today,
  });
  await publishTab(ctx, "Members", tab, {
    color: "#1565C0",
    line: membersLine(tab.rows, stamp()),
    statusRules: membersStatusRules,
  });
}

async function expensesStep(ctx: Ctx) {
  const expenses: ExpenseIn[] = docsOf(await db().collection("expenses").get()).map((d) => ({
    date: str(d["date"]),
    category: str(d["category"]),
    amount: num(d["amount"]),
    paymentMethod: str(d["paymentMethod"]),
    title: str(d["title"]),
    description: str(d["description"]),
    notes: str(d["notes"]),
    createdBy: str(d["createdBy"]),
  }));
  const tab = expensesTab({ expenses });
  await publishTab(ctx, "Expenses", tab, {
    color: "#607D8B",
    line: `${tab.rows.length} expenses, ${inr(tab.total ?? 0)} in all · updated ${stamp()}`,
  });
}

async function plansStep(ctx: Ctx) {
  const [plans, pts, clients, bills] = await Promise.all([
    db().collection("memberships").get(),
    db().collection("ptAssignments").get(),
    db().collection("clients").get(),
    db().collection("invoices").get(),
  ]);
  const tab = plansTab({
    plans: docsOf(plans).map(toPlan),
    pts: docsOf(pts).map(toPt),
    clients: new Map(docsOf(clients).map((d) => [d.id, toClient(d)])),
    bills: new Map(docsOf(bills).map((d) => [d.id, toBill(d)])),
  });
  await publishTab(ctx, "All plans", tab, {
    color: "#607D8B",
    line: `${tab.rows.length} plans · updated ${stamp()}`,
  });
}

async function staffStep(ctx: Ctx) {
  const [staff, trainers] = await Promise.all([
    db().collection("staff").get(),
    db().collection("trainers").get(),
  ]);
  const tab = staffTab({
    staff: docsOf(staff).map((d) => ({
      id: d.id,
      name: str(d["name"]),
      role: str(d["role"]),
      phone: str(d["phone"]),
      active: d["active"] !== false,
    })),
    trainers: docsOf(trainers).map((d) => ({
      name: str(d["name"]),
      phone: str(d["phone"]),
      status: str(d["status"]),
      staffId: str(d["staffId"]),
    })),
  });
  await publishTab(ctx, "Staff & trainers", tab, {
    color: "#607D8B",
    line: `${tab.rows.length} people · updated ${stamp()}`,
  });
}

async function packagesStep(ctx: Ctx) {
  const [packages, pt] = await Promise.all([
    db().collection("packages").get(),
    db().collection("ptPackages").get(),
  ]);
  const tab = packagesTab({
    packages: docsOf(packages).map(toPackage),
    ptPackages: docsOf(pt).map((d) => ({
      name: str(d["name"]),
      price: num(d["price"]),
      durationDays: num(d["durationDays"]),
      schedule: str(d["schedule"]),
      isActive: d["isActive"] !== false,
    })),
  });
  await publishTab(ctx, "Packages", tab, {
    color: "#607D8B",
    line: `${tab.rows.length} packages · updated ${stamp()}`,
  });
}

/* --------------------------------------------------------------- restore tabs */

const dataTitle = (col: string) => `_data_${col}`;

/** Hidden tab with every record of one collection: id | updatedAt | json (+ more json columns). */
async function dataFullStep(ctx: Ctx, col: string) {
  const title = dataTitle(col);
  const snap = await db().collection(col).get();
  const rows = snap.docs
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((d) => recordToRow(d.id, d.data()));
  const existed = (await ctx.client.meta()).tabs.some((t) => t.title === title);
  const h = createHash("sha1").update(JSON.stringify(rows)).digest("hex");
  const before = ctx.state.dataHash?.[col];
  if (existed && before?.h === h && Date.now() - before.at < HASH_TTL_MS) return;
  const sheetId = await ctx.client.ensureTab(title, { hidden: true });
  await ctx.client.writeTab(title, [["id", "updatedAt", "json"], ...rows]);
  if (!existed)
    await ctx.client.batchUpdate([
      {
        addProtectedRange: {
          protectedRange: {
            range: { sheetId },
            description: "Backup copy — written by the app",
            warningOnly: true,
          },
        },
      },
    ]);
  await stateRef().set({ dataHash: { [col]: { h, at: Date.now() } } }, { merge: true });
}

/** The docs that changed: update their rows in place, add new ones, clear the ones that are gone. */
async function dataTouchStep(ctx: Ctx, col: string): Promise<string[]> {
  const title = dataTitle(col);
  const paths = ctx.state.dirtyDocs.filter((p) => p.startsWith(`${col}/`));
  if (!(await ctx.client.meta()).tabs.some((t) => t.title === title)) {
    await dataFullStep(ctx, col);
    return paths;
  }
  if (!paths.length) return [];
  const ids = uniq(paths.map((p) => p.slice(col.length + 1)));
  const snaps = await db().getAll(...ids.map((id) => db().collection(col).doc(id)));
  const column = await ctx.client.readTab(title, "A:A");
  const rowOf = new Map<string, number>();
  column.forEach((r, i) => {
    const id = String(r[0] ?? "");
    if (i > 0 && id) rowOf.set(id, i + 1);
  });
  let next = Math.max(column.length, 1) + 1;
  const set: { row: number; values: Cell[] }[] = [];
  const clear: number[] = [];
  for (const s of snaps) {
    const row = rowOf.get(s.id);
    if (s.exists) set.push({ row: row ?? next++, values: recordToRow(s.id, s.data()!) });
    else if (row) clear.push(row);
  }
  await ctx.client.patchRows(title, set, clear);
  // The tab now differs from its last full copy.
  await stateRef().set({ dataHash: { [col]: FieldValue.delete() } }, { merge: true });
  return paths;
}

/* ------------------------------------------------------------------ Read me */

async function readmeStep(ctx: Ctx) {
  const { client } = ctx;
  // Locale, time zone and font: on the first run and on every full / nightly run (a quick run skips it).
  const first = !(await client.meta()).tabs.some((t) => t.title === "Read me");
  if (first || ctx.mode !== "quick") await client.batchUpdate(spreadsheetSetupRequests());
  const sheetId = await client.ensureTab("Read me", { index: 0 });
  const titles = (await client.meta()).tabs.map((t) => t.title).filter((t) => t !== "Sheet1");
  const order = tabOrder(titles);
  // Dues first, then the months newest first.
  const checks = [...ctx.checks].sort((a, b) => {
    const am = monthFromTitle(a.name);
    const bm = monthFromTitle(b.name);
    if (!am || !bm) return am ? 1 : bm ? -1 : a.name.localeCompare(b.name);
    return bm.localeCompare(am);
  });
  const rows = readMeRows({ updatedAt: `${stamp()} IST`, checks, tabs: order });
  await client.writeTab("Read me", rows);
  await client.batchUpdate(
    readMeFormatRequests(sheetId, rows.length, readMeCheckRows(rows), readMeLayout(rows)),
  );
  // The empty first tab of a new sheet goes once real tabs exist; then the tabs sit in reading order.
  await client.deleteTab("Sheet1");
  const now = (await client.meta()).tabs;
  const want = tabOrder(now.map((t) => t.title));
  const moves = want.flatMap((title, index) => {
    const t = now.find((x) => x.title === title);
    return t && t.index !== index
      ? [{ updateSheetProperties: { properties: { sheetId: t.sheetId, index }, fields: "index" } }]
      : [];
  });
  if (moves.length) await client.batchUpdate(moves);
}

/* ------------------------------------------------------------------- runner */

async function runStep(
  ctx: Ctx,
  step: string,
): Promise<{ doneDocs: string[]; doneMonth?: string }> {
  const [kind, arg = ""] = step.split(/:(.*)/s);
  switch (kind) {
    case "month":
      await monthStep(ctx, arg);
      return { doneDocs: [], doneMonth: arg };
    case "members":
      await membersStep(ctx);
      break;
    case "dues":
      await duesStep(ctx);
      break;
    case "expenses":
      await expensesStep(ctx);
      break;
    case "plans":
      await plansStep(ctx);
      break;
    case "staff":
      await staffStep(ctx);
      break;
    case "packages":
      await packagesStep(ctx);
      break;
    case "data":
      await dataFullStep(ctx, arg);
      // The whole collection was just copied: notes about single docs of it are done.
      return { doneDocs: ctx.state.dirtyDocs.filter((p) => p.startsWith(`${arg}/`)) };
    case "touch":
      return { doneDocs: await dataTouchStep(ctx, arg) };
    case "readme":
      await readmeStep(ctx);
      break;
    default:
      throw new Error(`Unknown backup step "${step}"`);
  }
  return { doneDocs: [] };
}

/** Root collections that belong in the restore tabs. */
async function restoreCollections() {
  return (await db().listCollections())
    .map((c) => c.id)
    .filter((id) => !EXCLUDED_COLLECTIONS.has(id));
}

async function earliestMonth() {
  const [p, i] = await Promise.all([
    db().collection("payments").orderBy("paymentDate").limit(1).get(),
    db().collection("invoices").orderBy("invoiceDate").limit(1).get(),
  ]);
  const months = [p.docs[0]?.get("paymentDate"), i.docs[0]?.get("invoiceDate")]
    .map((v) => monthOf(str(v)))
    .filter((m) => m && m >= EARLIEST_SANE_MONTH);
  return months.sort()[0] ?? null;
}

export interface RunResult {
  done: boolean;
  wrote: string[];
  checks: BackupState["checks"];
  /** Another run holds the lease: nothing was done, the changes are noted for it. */
  busy?: boolean;
  pending?: number;
  error?: string | null;
}

export async function runSheetBackup(opts: {
  mode: Mode;
  budgetMs: number;
  touched?: { months?: string[]; paths?: string[] };
}): Promise<RunResult> {
  const started = Date.now();
  const { held, state } = await acquire(opts.touched);
  if (held)
    return {
      done: false,
      wrote: [],
      checks: state.checks,
      busy: true,
      pending: state.queue.length,
      error: state.lastError,
    };

  const wrote: string[] = [];
  const failed = new Map<string, string>();
  let queue = state.queue;
  let checks = state.checks;
  let fatal: string | null = null;
  const ref = stateRef();
  try {
    const today = localDate();
    const dirtyCollections = uniq(state.dirtyDocs.map((p) => p.split("/")[0]!));
    const needsCollections = opts.mode !== "quick" || dirtyCollections.length > 0;
    const collections = needsCollections ? await restoreCollections() : [];
    const fresh =
      opts.mode === "quick" && !state.dirtyMonths.length && !dirtyCollections.length
        ? []
        : stepsFor({
            mode: opts.mode,
            today,
            collections,
            earliestMonth: opts.mode === "full" ? await earliestMonth() : null,
            months: state.dirtyMonths,
            touchedCollections: dirtyCollections,
          });
    queue = mergeQueue(state.queue, fresh);
    // Notes about docs in a collection that has no restore tab (gone, or never copied) would repeat forever.
    const orphans = needsCollections
      ? state.dirtyDocs.filter((p) => !collections.includes(p.split("/")[0]!))
      : [];
    await ref.set(
      { queue, ...(orphans.length ? { dirtyDocs: FieldValue.arrayRemove(...orphans) } : {}) },
      { merge: true },
    );

    const ctx: Ctx = {
      client: await sheetsClient(state.sheetId),
      today,
      mode: opts.mode,
      state,
      checks,
      memo: {},
    };
    for (const step of [...queue]) {
      if (Date.now() - started >= opts.budgetMs) break;
      try {
        const r = await runStep(ctx, step);
        wrote.push(step);
        queue = queue.filter((s) => s !== step);
        await ref.set(
          {
            queue,
            checks: ctx.checks,
            ...(r.doneMonth ? { dirtyMonths: FieldValue.arrayRemove(r.doneMonth) } : {}),
            ...(r.doneDocs.length ? { dirtyDocs: FieldValue.arrayRemove(...r.doneDocs) } : {}),
          },
          { merge: true },
        );
      } catch (e) {
        failed.set(step, String((e as Error)?.message ?? e).slice(0, 300));
      }
    }
    checks = ctx.checks;
  } catch (e) {
    fatal = String((e as Error)?.message ?? e).slice(0, 300);
  }

  const error = fatal ?? [...failed.values()][0] ?? null;
  const ok = !error && queue.length === 0 && checks.every((c) => c.ok);
  const now = new Date().toISOString();
  await ref
    .set(
      {
        queue,
        checks,
        lastRunAt: now,
        lastError: error,
        leaseUntil: 0,
        ...(ok ? { lastOkAt: now } : {}),
      },
      { merge: true },
    )
    .catch((e) => console.error("sheet backup: could not save the state", String(e)));
  return { done: queue.length === 0, wrote, checks, pending: queue.length, error };
}

/* ------------------------------------------------------------------- routes */

const PATH = /^[A-Za-z]+\/[A-Za-z0-9_-]+$/;

/** The months a changed doc can affect, worked out here from the stored dates (never trusted from the browser). */
async function monthsOfPaths(paths: string[], today: string): Promise<string[]> {
  const cur = today.slice(0, 7);
  const months = new Set<string>();
  const money = paths.filter((p) => p.startsWith("payments/") || p.startsWith("invoices/"));
  if (money.length) {
    const snaps = await db().getAll(...money.map((p) => db().doc(p)));
    snaps.forEach((s, i) => {
      const isPay = money[i]!.startsWith("payments/");
      const m = s.exists ? monthOf(str(s.get(isPay ? "paymentDate" : "invoiceDate"))) : "";
      if (m && m <= cur) months.add(m);
      else {
        // Removed or oddly dated: it was most likely this or last month.
        months.add(cur);
        months.add(prevMonth(cur));
      }
      // A bill's balance shows on the rows of its payments, which are mostly this month's.
      if (!isPay) months.add(cur);
    });
  }
  // Plan and member changes (cancel, edit, renew) show on the month's rows.
  if (paths.some((p) => /^(memberships|ptAssignments|clients)\//.test(p))) months.add(cur);
  return [...months];
}

const serviceEmail = () => {
  try {
    return credentials().clientEmail;
  } catch {
    return "";
  }
};

export async function handleSheetBackup(request: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const user = await requireStaff(request);
  if (!user) return json({ error: "Sign in required." }, 401);
  const owner = isOwnerEmail(user.email);
  const body = async () =>
    ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (path === "/api/backup/sheet/touch") {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const raw = (await body())["paths"];
    if (!Array.isArray(raw) || raw.length > 200) return json({ error: "Bad paths." }, 400);
    const paths = uniq(
      raw.filter(
        (p): p is string =>
          typeof p === "string" && PATH.test(p) && !EXCLUDED_COLLECTIONS.has(p.split("/")[0]!),
      ),
    );
    if (!paths.length) return json({ ok: true });
    try {
      const months = await monthsOfPaths(paths, localDate());
      const r = await runSheetBackup({
        mode: "quick",
        budgetMs: 25_000,
        touched: { months, paths },
      });
      return json({ ok: !r.error });
    } catch (e) {
      // The sale already went through: a backup problem is shown on the Backup page, not here.
      console.error("sheet backup touch failed", String((e as Error)?.message ?? e));
      return json({ ok: false });
    }
  }

  if (!owner) return json({ error: "Only the owner can do this." }, 403);

  if (path === "/api/backup/sheet/status") {
    const st = await loadState();
    return json({
      sheetUrl: `https://docs.google.com/spreadsheets/d/${st.sheetId}/edit`,
      lastOkAt: st.lastOkAt,
      lastRunAt: st.lastRunAt,
      lastError: st.lastError,
      checks: st.checks,
      pending: st.queue.length,
      shareWith: serviceEmail(),
    });
  }

  if (path === "/api/backup/sheet/sync") {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const full = (await body())["mode"] === "full";
    const r = await runSheetBackup({ mode: full ? "full" : "quick", budgetMs: 40_000 });
    return json({
      ok: !r.error,
      done: r.done,
      busy: r.busy ?? false,
      pending: r.pending ?? 0,
      wrote: r.wrote,
      error: r.error ?? null,
    });
  }

  if (path === "/api/backup/sheet/settings") {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const link = String((await body())["sheetUrl"] ?? "").trim();
    const id =
      /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(link)?.[1] ??
      (/^[A-Za-z0-9_-]{20,}$/.test(link) ? link : "");
    if (!id) return json({ error: "That does not look like a Google Sheet link." }, 400);
    try {
      await (await sheetsClient(id)).meta();
    } catch (e) {
      return json(
        {
          error: `The app cannot open that sheet. Share it with ${serviceEmail() || "the app's service account"} as Editor, then try again. (${String((e as Error)?.message ?? e).slice(0, 120)})`,
        },
        400,
      );
    }
    await stateRef().set(
      {
        sheetId: id,
        queue: [],
        checks: [],
        dirtyMonths: [],
        dirtyDocs: [],
        lastOkAt: null,
        lastError: null,
        leaseUntil: 0,
      },
      { merge: true },
    );
    return json({ ok: true, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  }

  return json({ error: "Not found." }, 404);
}
