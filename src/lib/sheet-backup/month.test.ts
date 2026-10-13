import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMonth, CATEGORY_LABEL, dmy, MONTH_COLUMNS, type MonthInput } from "./month.ts";
import type { BillIn, ClientIn, PackageIn, PayIn, PlanIn, PtIn } from "./types.ts";

const client: ClientIn = {
  id: "c1",
  clientCode: "RF0001",
  fullName: "Asha Rao",
  phone: "9876500001",
};
const pkg: PackageIn = {
  id: "pk1",
  name: "Gold",
  category: "Strength + Cardio",
  durationDays: 30,
  price: 2000,
  isActive: true,
};
const plan = (over: Partial<PlanIn> = {}): PlanIn => ({
  id: "m1",
  clientId: "c1",
  packageId: "pk1",
  packageNameSnapshot: "1 month",
  priceSnapshot: 2000,
  durationDaysSnapshot: 30,
  startDate: "2026-09-30",
  endDate: "2026-10-29",
  status: "active",
  counsellorName: "Ravi",
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
  amountPaid: 2000,
  balanceDue: 0,
  paymentStatus: "paid",
  paymentMethod: "Cash",
  invoiceDate: "2026-10-08",
  dueDate: "",
  membershipGross: 2000,
  ptGross: 0,
  counsellorName: "Ravi",
  createdDay: "2026-10-08",
  ...over,
});
const pay = (over: Partial<PayIn> = {}): PayIn => ({
  id: "p1",
  clientId: "c1",
  clientNameSnapshot: "Asha Rao",
  invoiceId: "b1",
  membershipId: "m1",
  ptAssignmentId: null,
  amount: 2000,
  method: "Cash",
  paymentDate: "2026-10-08",
  kind: "initial",
  counsellorName: "Ravi",
  createdDay: "2026-10-08",
  ...over,
});

function input(over: {
  from?: string;
  to?: string;
  payments?: PayIn[];
  legacyBills?: BillIn[];
  bills?: BillIn[];
  plans?: PlanIn[];
  pts?: PtIn[];
  plansOfClients?: PlanIn[];
}): MonthInput {
  const plans = over.plans ?? [plan()];
  return {
    from: over.from ?? "2026-10-01",
    to: over.to ?? "2026-10-13",
    payments: over.payments ?? [],
    legacyBills: over.legacyBills ?? [],
    bills: new Map((over.bills ?? [bill()]).map((b) => [b.id, b])),
    plans: new Map(plans.map((p) => [p.id, p])),
    pts: new Map((over.pts ?? []).map((p) => [p.id, p])),
    clients: new Map([[client.id, client]]),
    packages: new Map([[pkg.id, pkg]]),
    plansOfClients: over.plansOfClients ?? plans,
  };
}

test("late sale: dated the day it was paid, shows in that month only, with a note", () => {
  const late = pay({ paymentDate: "2026-09-30", createdDay: "2026-10-08" });
  const sep = buildMonth(input({ from: "2026-09-01", to: "2026-09-30", payments: [late] }));
  assert.equal(sep.rows.length, 1);
  assert.equal(sep.rows[0]?.note, "entered later, dated the day it was paid");
  assert.equal(sep.rows[0]?.date, "2026-09-30");
  assert.equal(sep.matches, true);
  assert.equal(sep.appTotal, 2000);
  // The October input (the caller filters by paymentDate) has no such payment.
  const oct = buildMonth(input({ payments: [] }));
  assert.equal(oct.rows.length, 0);
  assert.equal(oct.matches, true);
});

test("split pair is one row: CASH + PP, paid is the sum", () => {
  const a = pay({ id: "p1", amount: 1000, method: "Cash", splitId: "s1" });
  const b = pay({ id: "p2", amount: 1000, method: "UPI", splitId: "s1" });
  const m = buildMonth(input({ payments: [a, b] }));
  assert.equal(m.rows.length, 1);
  const r = m.rows[0]!;
  assert.equal(r.cash, 1000);
  assert.equal(r.pp, 1000);
  assert.equal(r.paid, 2000);
  assert.equal(m.appTotal, 2000);
  assert.equal(m.matches, true);
});

test("a ₹1 balance is a Balance row with a top-up note and no fees", () => {
  const p = pay({
    amount: 1,
    kind: "balance",
    paymentDate: "2026-10-10",
    createdDay: "2026-10-10",
  });
  const r = buildMonth(input({ payments: [p] })).rows[0]!;
  assert.equal(r.kind, "Balance");
  assert.ok(r.note.includes("₹1 top-up"));
  assert.equal(r.gymFee, "");
  assert.equal(r.totalBill, "");
});

test("a refund is negative and counted in the app total", () => {
  const sale = pay({ id: "p1", amount: 2000 });
  const refund = pay({
    id: "p2",
    amount: -500,
    kind: "refund",
    paymentDate: "2026-10-09",
    createdDay: "2026-10-09",
  });
  const m = buildMonth(input({ payments: [sale, refund] }));
  const r = m.rows.find((x) => x.kind === "Refund")!;
  assert.equal(r.status, "Refunded");
  assert.equal(r.paid, -500);
  assert.equal(m.appTotal, 1500);
  assert.equal(m.sheetTotal, 1500);
  assert.equal(m.matches, true);
});

test("an old bill with no payment records is counted on its bill date", () => {
  const legacy = bill({
    id: "b9",
    invoiceNumber: "INV-9",
    amountPaid: 1500,
    paymentsTracked: false,
    membershipId: null,
    paymentMethod: "Cash",
    balanceDue: 500,
  });
  const sale = pay({ amount: 2000 });
  const m = buildMonth(input({ payments: [sale], legacyBills: [legacy], bills: [bill(), legacy] }));
  const r = m.rows.find((x) => x.kind === "Bill (no payment record)")!;
  assert.equal(r.cash, 1500);
  assert.equal(r.status, "Part paid");
  assert.equal(m.appTotal, 3500);
  assert.equal(m.matches, true);
});

test("renewal when the member has an earlier plan, new when not", () => {
  const earlier = plan({ id: "m0", startDate: "2026-08-01", endDate: "2026-08-30" });
  const renew = buildMonth(
    input({ payments: [pay()], plansOfClients: [earlier, plan()], plans: [plan()] }),
  );
  assert.equal(renew.rows[0]?.kind, "Renewal");
  const fresh = buildMonth(input({ payments: [pay()] }));
  assert.equal(fresh.rows[0]?.kind, "New");
  assert.equal(fresh.rows[0]?.type, "Cardio & strengthening");
});

test("old-software payment without a bill goes in its own column and keeps the balance", () => {
  const p = pay({
    id: "po",
    invoiceId: "none",
    amount: 3000,
    method: "Not recorded",
    oldSoftware: true,
    oldSoftwareBillNo: "77",
  });
  const m = buildMonth(
    input({ payments: [p], bills: [], plans: [plan({ oldSoftwareBalance: 1200 })] }),
  );
  const r = m.rows[0]!;
  assert.equal(r.kind, "Old software");
  assert.equal(r.old, 3000);
  assert.equal(r.pp, 0);
  assert.equal(r.cash, 0);
  assert.equal(r.card, 0);
  assert.equal(r.due, 1200);
  assert.equal(r.billNo, "Old 77");
  assert.equal(r.totalBill, 4200);
  assert.equal(m.dueOnBills, 1200);
});

test("columns are in the approved order", () => {
  assert.deepEqual(
    MONTH_COLUMNS.map((c) => c.header),
    [
      "S.NO",
      "DATE PAID",
      "NAME",
      "PHONE NO",
      "PAYMENT FOR",
      "PACKAGE",
      "PP",
      "CASH",
      "CARD",
      "OTHER",
      "PAID IN OLD SOFTWARE",
      "PAID AMOUNT",
      "DUE NOW",
      "TOTAL BILL",
      "GYM FEE",
      "PT FEE",
      "DISCOUNT",
      "Counseller",
      "PT Trainer",
      "TYPE OF CLIENT",
      "START DATE",
      "ENDING DATE",
      "DAYS",
      "PT End date",
      "Membership payment due date",
      "STATUS",
      "NOTE",
      "ENTERED ON",
      "BILL NO",
      "MEMBER ID",
    ],
  );
  for (const c of MONTH_COLUMNS) assert.ok(c.width > 0, c.header);
});

test("sale row money, cancelled status, due counted once per bill, sort by date then bill no", () => {
  const b = bill({
    total: 1700,
    discount: 300,
    subtotal: 2000,
    amountPaid: 1000,
    balanceDue: 700,
    dueDate: "2026-10-20",
  });
  const first = pay({ id: "p1", amount: 1000 });
  const second = pay({
    id: "p2",
    amount: 100,
    kind: "balance",
    paymentDate: "2026-10-09",
    createdDay: "2026-10-09",
  });
  const m = buildMonth(
    input({ payments: [second, first], bills: [b], plans: [plan({ status: "cancelled" })] }),
  );
  assert.deepEqual(
    m.rows.map((r) => r.kind),
    ["New", "Balance"],
  );
  const sale = m.rows[0]!;
  assert.equal(sale.gymFee, 1700);
  assert.equal(sale.totalBill, 1700);
  assert.equal(sale.discount, 300);
  assert.equal(sale.payBy, "2026-10-20");
  assert.equal(sale.status, "Cancelled");
  assert.equal(m.dueOnBills, 700); // both rows are on one bill
});

test("helpers", () => {
  assert.equal(dmy("2026-10-13"), "13-10-2026");
  assert.equal(dmy(""), "");
  assert.equal(CATEGORY_LABEL["Strength Only"], "Strengthening");
  assert.equal(CATEGORY_LABEL["Cardio Only"], "Cardio");
});
