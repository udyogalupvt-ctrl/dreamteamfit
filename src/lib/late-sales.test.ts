import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateSetByHand,
  LATE_TOOL,
  lateUndoable,
  planLateSales,
  saleMoneyDay,
  type LateSaleFact,
} from "./late-sales.ts";

const TODAY = "2026-10-09";
const OPEN = "2026-09-01";

const day = (over: Partial<Parameters<typeof saleMoneyDay>[0]> = {}) =>
  saleMoneyDay({
    startDate: "2026-10-02",
    today: TODAY,
    openFrom: OPEN,
    upgrade: false,
    paidToday: false,
    ...over,
  });

test("a plan that started before today: its money counts on the plan's first day", () => {
  assert.equal(day(), "2026-10-02");
  assert.equal(day({ startDate: "2026-09-01" }), "2026-09-01");
});

test("starting today or later, an upgrade, or 'paid today': counted today", () => {
  assert.equal(day({ startDate: TODAY }), TODAY);
  assert.equal(day({ startDate: "2026-10-20" }), TODAY);
  assert.equal(day({ upgrade: true }), TODAY);
  assert.equal(day({ paidToday: true }), TODAY);
});

test("a first day the Day Book has carried forward (before the 1st of last month): today", () => {
  assert.equal(day({ startDate: "2026-08-31" }), TODAY);
  assert.equal(day({ startDate: "" }), TODAY);
  assert.equal(day({ startDate: "2 Oct" }), TODAY);
});

test("a date set by hand is kept; the tool's own lines are not 'by hand'", () => {
  assert.equal(dateSetByHand(undefined), false);
  assert.equal(dateSetByHand([{ changes: ["Mode Cash → UPI"] }]), false);
  assert.equal(dateSetByHand([{ changes: ["Date 8 Oct 2026 → 5 Oct 2026"] }]), true);
  assert.equal(
    dateSetByHand([{ changes: ["Date 8 Oct 2026 → 2 Oct 2026"], tool: LATE_TOOL }]),
    false,
  );
});

const fact = (over: Partial<LateSaleFact> = {}): LateSaleFact => ({
  paymentId: "p1",
  clientId: "c1",
  clientName: "A. Sharath Kumar",
  plan: "1 month strengthening",
  startDate: "2026-10-02",
  planStatus: "active",
  paidInOldSoftware: false,
  paymentDate: "2026-10-08",
  amount: 1699,
  method: "UPI",
  kind: "initial",
  oldSoftware: false,
  invoiceId: "b1",
  invoiceNumber: "RF-2026-000076",
  billStatus: "paid",
  upgradeCredit: 0,
  dateSetByHand: false,
  ...over,
});

test("the reported case: typed in on 8 Oct for a plan from 2 Oct → moves to 2 Oct", () => {
  const r = planLateSales([fact()], OPEN);
  assert.equal(r.move.length, 1);
  assert.deepEqual(
    { from: r.move[0]!.from, to: r.move[0]!.to, amount: r.move[0]!.amount },
    { from: "2026-10-08", to: "2026-10-02", amount: 1699 },
  );
  assert.equal(r.total, 1699);
  // Same month: the month's total does not change.
  assert.deepEqual(r.months, []);
  assert.deepEqual(r.skipped, []);
});

test("not a late sale: paid on or before the first day, balance payments, refunds, old money", () => {
  const r = planLateSales(
    [
      fact({ paymentId: "same", paymentDate: "2026-10-02" }),
      fact({ paymentId: "early", paymentDate: "2026-09-30" }),
      fact({ paymentId: "bal", kind: "balance" }),
      fact({ paymentId: "ref", kind: "refund", amount: -500 }),
      fact({ paymentId: "old", oldSoftware: true }),
      fact({ paymentId: "nobill", invoiceId: "" }),
      fact({ paymentId: "zero", amount: 0 }),
      fact({ paymentId: "nostart", startDate: "" }),
    ],
    OPEN,
  );
  assert.deepEqual(r.move, []);
  assert.deepEqual(r.skipped, []);
});

test("left as they are, each with its reason", () => {
  const r = planLateSales(
    [
      fact({ paymentId: "o", paidInOldSoftware: true }),
      fact({ paymentId: "c", planStatus: "cancelled" }),
      fact({ paymentId: "u", upgradeCredit: 400 }),
      fact({ paymentId: "x", billStatus: "closed" }),
      fact({ paymentId: "r", billStatus: "refunded" }),
      fact({ paymentId: "m", billStatus: "missing" }),
      fact({ paymentId: "h", dateSetByHand: true }),
      fact({ paymentId: "b", startDate: "2026-08-20" }),
    ],
    OPEN,
  );
  assert.deepEqual(r.move, []);
  assert.deepEqual(
    r.skipped.map((s) => [s.paymentId, s.reason]),
    [
      ["o", "old-software"],
      ["c", "cancelled"],
      ["u", "upgrade"],
      ["x", "bill-closed"],
      ["r", "bill-closed"],
      ["m", "bill-closed"],
      ["h", "date-set"],
      ["b", "before-open"],
    ],
  );
  assert.equal(r.skipped[7]!.start, "2026-08-20");
});

test("a plan from last month typed in this month: the months' totals change, the sum doesn't", () => {
  const r = planLateSales(
    [
      fact({ paymentId: "a", startDate: "2026-09-28", amount: 5800, method: "Cash" }),
      fact({ paymentId: "b", startDate: "2026-09-15", paymentDate: "2026-10-01", amount: 1999.5 }),
      fact({ paymentId: "c" }),
    ],
    OPEN,
  );
  assert.equal(r.move.length, 3);
  assert.equal(r.total, 9498.5);
  assert.deepEqual(r.months, [
    { month: "2026-09", change: 7799.5 },
    { month: "2026-10", change: -7799.5 },
  ]);
  // Newest typed-in day first.
  assert.deepEqual(
    r.move.map((m) => m.paymentId),
    ["a", "c", "b"],
  );
});

test("undo puts back only payments still on the day the run gave them", () => {
  const item = { paymentId: "p1", from: "2026-10-08", to: "2026-10-02" };
  assert.equal(lateUndoable(item, { paymentDate: "2026-10-02", amount: 1699 }), true);
  assert.equal(lateUndoable(item, { paymentDate: "2026-10-05", amount: 1699 }), false);
  assert.equal(lateUndoable(item, null), false);
});
