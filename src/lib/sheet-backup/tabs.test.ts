import assert from "node:assert/strict";
import { test } from "node:test";
import {
  duesTab,
  expensesTab,
  membersTab,
  packagesTab,
  plansTab,
  readMeCheckRows,
  readMeRows,
  staffTab,
} from "./tabs.ts";
import type { BillIn, ClientIn, PlanIn, PtIn } from "./types.ts";

const TODAY = "2026-10-13";
const client = (over: Partial<ClientIn> = {}): ClientIn => ({
  id: "c1",
  clientCode: "RF0001",
  fullName: "Asha Rao",
  phone: "9876500001",
  ...over,
});
const bill = (over: Partial<BillIn> = {}): BillIn => ({
  id: "b1",
  invoiceNumber: "INV-10",
  clientId: "c1",
  clientNameSnapshot: "Asha Rao",
  membershipId: "m1",
  ptAssignmentId: null,
  items: [{ name: "1 month" }],
  subtotal: 2000,
  discount: 0,
  total: 2000,
  amountPaid: 1000,
  balanceDue: 1000,
  paymentStatus: "partial",
  paymentMethod: "Cash",
  invoiceDate: "2026-10-01",
  dueDate: "2026-10-10",
  membershipGross: 2000,
  ptGross: 0,
  counsellorName: "Ravi",
  createdDay: "2026-10-01",
  ...over,
});
const plan = (over: Partial<PlanIn> = {}): PlanIn => ({
  id: "m1",
  clientId: "c1",
  packageId: "pk1",
  packageNameSnapshot: "1 month",
  priceSnapshot: 2000,
  durationDaysSnapshot: 30,
  startDate: "2026-10-01",
  endDate: "2026-10-30",
  status: "active",
  counsellorName: "Ravi",
  invoiceId: "b1",
  ...over,
});
const pt = (over: Partial<PtIn> = {}): PtIn => ({
  id: "t1",
  clientId: "c1",
  ptPackageNameSnapshot: "PT monthly",
  trainerNameSnapshot: "Kiran",
  startDate: "2026-10-02",
  endDate: "2026-11-01",
  status: "active",
  ptPrice: 5000,
  invoiceId: "b2",
  ...over,
});
const member = (endDate: string, over: Record<string, unknown> = {}) => ({
  ...client(),
  status: "active",
  currentMembership: { packageName: "1 month", startDate: "2026-09-01", endDate, status: "active" },
  ...over,
});
const cell = (tab: { columns: { header: string; value(r: never, i: number): unknown }[]; rows: unknown[] }, header: string, i = 0) => {
  const col = tab.columns.find((c) => c.header === header);
  assert.ok(col, `column ${header}`);
  return col.value(tab.rows[i] as never, i);
};

test("members STATUS: ending soon, ended, active, no plan", () => {
  const tab = membersTab({
    clients: [
      member("2026-10-16", { id: "a", fullName: "A" }),
      member("2026-10-12", { id: "b", fullName: "B" }),
      member("2026-11-30", { id: "c", fullName: "C" }),
      { ...client({ id: "d", fullName: "D" }), status: "active", currentMembership: null },
      member("2026-10-20", { id: "e", fullName: "E", currentMembership: { packageName: "x", startDate: "2026-09-20", endDate: "2026-10-20", status: "cancelled" } }),
    ],
    pts: [],
    openBills: [],
    today: TODAY,
  });
  const status = (name: string) => {
    const i = tab.rows.findIndex((r) => cell({ ...tab, rows: [r] }, "NAME") === name);
    return cell(tab, "STATUS", i);
  };
  assert.equal(status("A"), "Ending in 7 days");
  assert.equal(status("B"), "Ended");
  assert.equal(status("C"), "Active");
  assert.equal(status("D"), "No plan");
  assert.equal(status("E"), "Ended");
  assert.deepEqual(tab.columns.map((c) => c.header), [
    "MEMBER ID", "NAME", "PHONE NO", "GENDER", "DATE OF BIRTH", "JOINED", "CURRENT PLAN", "START DATE",
    "ENDING DATE", "DAYS LEFT", "STATUS", "PT TRAINER", "PT END", "BALANCE DUE", "LAST VISIT",
  ]);
});

test("members: DAYS LEFT is a live formula on the ENDING DATE cell, PT and balance are joined", () => {
  const tab = membersTab({
    clients: [member("2026-11-30")],
    pts: [pt(), pt({ id: "t2", status: "cancelled", trainerNameSnapshot: "Old" })],
    openBills: [bill({ balanceDue: 700 }), bill({ id: "b3", balanceDue: 300 })],
    today: TODAY,
  });
  // header row 1, totals row 2: the first data row is sheet row 3, ENDING DATE is column I.
  assert.equal(cell(tab, "DAYS LEFT", 0), '=IF(I3="","",MAX(0,I3-TODAY()))');
  assert.equal(cell(tab, "DAYS LEFT", 4), '=IF(I7="","",MAX(0,I7-TODAY()))');
  assert.equal(cell(tab, "PT TRAINER"), "Kiran");
  assert.equal(cell(tab, "PT END"), "2026-11-01");
  assert.equal(cell(tab, "BALANCE DUE"), 1000);
  assert.equal(cell(tab, "ENDING DATE"), "2026-11-30");
});

test("dues total is the open bills only (closed and refunded are excluded)", () => {
  const tab = duesTab({
    openBills: [
      bill({ id: "b1", balanceDue: 700 }),
      bill({ id: "b2", invoiceNumber: "INV-11", balanceDue: 300, dueDate: "" }),
      bill({ id: "b3", balanceDue: 500, paymentStatus: "closed" }),
      bill({ id: "b4", balanceDue: 400, paymentStatus: "refunded" }),
      bill({ id: "b5", balanceDue: 0, paymentStatus: "paid" }),
    ],
    clients: new Map([["c1", client()]]),
    today: TODAY,
  });
  assert.equal(tab.rows.length, 2);
  assert.equal(tab.total, 1000);
  assert.equal(cell(tab, "DAYS OVERDUE", 0), '=IF(H3="","",IF(TODAY()>H3,TODAY()-H3,""))');
  assert.equal(cell(tab, "NAME"), "Asha Rao");
  // The dated bill (most overdue) comes first.
  assert.equal(cell(tab, "PAY BY", 0), "2026-10-10");
  assert.equal(cell(tab, "PAY BY", 1), "");
  assert.deepEqual(tab.columns.map((c) => c.header), [
    "NAME", "PHONE NO", "BILL NO", "BILL DATE", "TOTAL BILL", "PAID", "DUE", "PAY BY", "DAYS OVERDUE", "MEMBER ID",
  ]);
});

test("expenses: newest first with a total", () => {
  const tab = expensesTab({
    expenses: [
      { date: "2026-10-01", category: "Rent", amount: 20000, paymentMethod: "UPI", title: "October rent", createdBy: "Owner" },
      { date: "2026-10-12", category: "Supplies", amount: 450, paymentMethod: "Cash", description: "towels", notes: "from the market" },
    ],
  });
  assert.equal(tab.total, 20450);
  assert.equal(cell(tab, "DATE", 0), "2026-10-12");
  assert.equal(cell(tab, "NOTE", 0), "towels · from the market");
  assert.equal(cell(tab, "NOTE", 1), "October rent");
  assert.equal(cell(tab, "MODE", 1), "UPI");
  assert.deepEqual(tab.columns.map((c) => c.header), ["DATE", "CATEGORY", "AMOUNT", "MODE", "NOTE", "ADDED BY"]);
});

test("plans tab has one row per gym plan and per PT plan, newest start first", () => {
  const tab = plansTab({
    plans: [plan(), plan({ id: "m0", startDate: "2026-08-01", endDate: "2026-08-30", paidInOldSoftware: true, invoiceId: "none" })],
    pts: [pt()],
    clients: new Map([["c1", client()]]),
    bills: new Map([["b1", bill()], ["b2", bill({ id: "b2", invoiceNumber: "INV-12" })]]),
  });
  assert.equal(tab.rows.length, 3);
  assert.deepEqual([0, 1, 2].map((i) => cell(tab, "KIND", i)), ["PT", "Gym", "Gym"]);
  assert.equal(cell(tab, "BILL NO", 0), "INV-12");
  assert.equal(cell(tab, "BILL NO", 1), "INV-10");
  assert.equal(cell(tab, "FROM OLD SOFTWARE", 2), "Yes");
  assert.equal(cell(tab, "FROM OLD SOFTWARE", 1), "");
  assert.equal(cell(tab, "COUNSELLER / TRAINER", 0), "Kiran");
  assert.equal(cell(tab, "MEMBER ID", 0), "RF0001");
});

test("staff and trainers: no secrets, a trainer already on the Staff page is not listed twice", () => {
  const tab = staffTab({
    staff: [
      { id: "s1", name: "Ravi", role: "Counsellor", phone: "111", active: true },
      { id: "s2", name: "Kiran", role: "Trainer", phone: "222", active: false },
    ],
    trainers: [
      { name: "Kiran", phone: "222", status: "active", staffId: "s2" },
      { name: "Old Coach", phone: "333", status: "inactive" },
    ],
  });
  assert.equal(tab.rows.length, 3);
  assert.deepEqual(tab.columns.map((c) => c.header), ["NAME", "ROLE", "PHONE NO", "ACTIVE"]);
  assert.equal(cell(tab, "ROLE", 2), "Trainer");
  assert.equal(cell(tab, "ACTIVE", 0), "Yes");
  assert.equal(cell(tab, "ACTIVE", 2), "No");
});

test("packages: gym packages then PT packages", () => {
  const tab = packagesTab({
    packages: [{ id: "pk1", name: "Gold", category: "Strength + Cardio", durationDays: 30, price: 2000, isActive: true }],
    ptPackages: [{ name: "PT monthly", price: 5000, durationDays: 30, schedule: "daily", isActive: false }],
  });
  assert.equal(tab.rows.length, 2);
  assert.equal(cell(tab, "CATEGORY", 0), "Cardio & strengthening");
  assert.equal(cell(tab, "ACTIVE", 1), "No");
  assert.equal(cell(tab, "PRICE", 1), 5000);
});

test("read me lists every tab, shows ticks and crosses, and what to do if the app is down", () => {
  const rows = readMeRows({
    updatedAt: "13 Oct 2026, 10:42 pm",
    checks: [
      { name: "Oct 2026", ok: true, detail: "₹2,07,049" },
      { name: "Sep 2026", ok: false, detail: "₹1,00,000 vs ₹99,999" },
    ],
    tabs: ["Read me", "Members", "Dues", "Oct 2026", "Expenses", "_data_payments"],
  });
  const flat = rows.map((r) => r.join(" | "));
  assert.equal(rows[0]?.[0], "REBUILD FITNESS — Backup");
  assert.ok(flat.some((l) => l.startsWith("Last updated: 13 Oct 2026, 10:42 pm")));
  assert.ok(flat.some((l) => l.startsWith("Members | ")));
  assert.ok(flat.some((l) => l.startsWith("Oct 2026 | ")));
  assert.ok(flat.some((l) => l.startsWith("✓ Oct 2026 matches the app (₹2,07,049)")));
  assert.ok(flat.some((l) => l.startsWith("✗ Sep 2026")));
  assert.ok(flat.some((l) => l.includes("If the app is down")));
  assert.ok(!flat.some((l) => l.startsWith("_data_payments |")), "restore tabs get one shared line");
  assert.deepEqual(readMeCheckRows(rows).map((c) => c.ok), [true, false]);
});

test("read me with a failing check contains a cross", () => {
  const rows = readMeRows({ updatedAt: "x", checks: [{ name: "Dues", ok: false, detail: "₹1" }], tabs: [] });
  assert.ok(rows.some((r) => String(r[0]).includes("✗")));
});
