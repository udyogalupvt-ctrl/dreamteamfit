import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCfo } from "./numbers.ts";
import {
  DEFAULT_CFO_SETTINGS,
  type CfoComputed,
  type CfoInput,
  type CfoMonth,
  type CfoSettings,
} from "./types.ts";
import {
  allNumbers,
  bill,
  expense,
  gym,
  gymBilled,
  income,
  input,
  member,
  payment,
  payout,
  pt,
  trainer,
  withPlans,
} from "./testkit.ts";

const META = { computedAt: "2026-10-06T02:30:00.000Z", computedBy: "test" };
const run = (i: CfoInput, s: Partial<CfoSettings> = {}): CfoComputed =>
  computeCfo(i, { ...DEFAULT_CFO_SETTINGS, ...s }, META);

const close = (a: number | null, b: number, msg = "") => {
  assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${msg} expected ${b}, got ${a}`);
};

function month(c: CfoComputed, key: string): CfoMonth {
  const m = c.snapshot.months.find((x) => x.key === key);
  assert.ok(m, `month ${key} missing`);
  return m;
}

/** The invariants every snapshot must keep, whatever the data. */
function assertInvariants(c: CfoComputed) {
  const s = c.snapshot;
  for (const n of allNumbers(c)) assert.ok(Number.isFinite(n), `non-finite number ${n}`);
  for (const m of s.months) {
    assert.equal(m.profit, m.earned.total - m.expenses.total, `profit ${m.key}`);
    assert.equal(m.earned.total, m.earned.gym + m.earned.pt + m.earned.other, `earned ${m.key}`);
    const cats = Object.values(m.expenses.byCategory).reduce((a, b) => a + b, 0);
    assert.equal(cats, m.expenses.total, `categories ${m.key}`);
    assert.equal(m.earned.pt, m.ptIncome - m.trainerShare, `pt ${m.key}`);
    for (const v of [m.earned.gym, m.earned.pt, m.earned.other, m.received, m.expenses.total]) {
      assert.ok(Number.isInteger(v), `whole rupees ${m.key}`);
    }
  }
  const p = s.cash.parts;
  if (s.cash.set) {
    assert.equal(
      s.cash.freeCash,
      s.cash.balance! -
        s.advanceOwed +
        p.trainerShareInAdvance -
        p.pendingTrainer -
        p.unsettledStaffPaid,
    );
    assert.equal(
      s.cash.balance,
      s.cash.openingBalance! +
        p.payments +
        p.oldBills +
        p.otherIncome -
        p.expensesPaid -
        p.trainerPaid,
    );
  }
  assert.equal(
    s.dues.total,
    Object.values(s.dues.groups).reduce((a, g) => a + g.amount, 0),
  );
  assert.equal(
    s.dues.count,
    Object.values(s.dues.groups).reduce((a, g) => a + g.count, 0),
  );
}

/**
 * Scenario A (today 2026-10-06, 10 Rs/day yearly plan, 100 Rs/day monthly plans):
 *  A  yearly 2026-01-01..12-31 Rs 3650 paid in full           -> Rs 10 a day
 *  B  monthly 09-01..09-30 Rs 3000 paid in full               -> Rs 100 a day
 *  C  monthly 09-20..10-19 Rs 3000, Rs 1500 paid, due 09-25  -> Rs 100 a day
 *  Expenses: Jul 1000, Aug 2000, Sep 2000 + 500 + 100 (custom "Chai"). Other income Rs 200 on 09-03.
 */
function scenarioA(): CfoInput {
  const a = gymBilled("gA", "A", "2026-01-01", "2026-12-31", 3650);
  const b = gymBilled("gB", "B", "2026-09-01", "2026-09-30", 3000, { plan: { status: "expired" } });
  const c = gymBilled("gC", "C", "2026-09-20", "2026-10-19", 3000, {
    paid: 1500,
    bill: { dueDate: "2026-09-25" },
  });
  return withPlans(
    input({
      firstExpenseDate: "2026-07-05",
      members: [
        member({ id: "A", joinedOn: "2026-01-01" }),
        member({ id: "B", joinedOn: "2026-09-01" }),
        member({ id: "C", joinedOn: "2026-09-20" }),
        member({ id: "D", joinedOn: "2026-02-01" }),
      ],
      payments: [
        payment({ id: "pA", amount: 3650, paymentDate: "2026-01-01" }),
        payment({ id: "pB", amount: 3000, paymentDate: "2026-09-01" }),
        payment({ id: "pC", amount: 1500, paymentDate: "2026-09-20" }),
      ],
      expenses: [
        expense({ id: "e1", amount: 1000, date: "2026-07-05", category: "Rent" }),
        expense({ id: "e2", amount: 2000, date: "2026-08-02", category: "Rent" }),
        expense({ id: "e3", amount: 2000, date: "2026-09-02", category: "Rent" }),
        expense({ id: "e4", amount: 500, date: "2026-09-10", category: "Electricity" }),
        expense({ id: "e5", amount: 100, date: "2026-09-11", category: "Chai" }),
      ],
      otherIncome: [income({ id: "i1", amount: 200, date: "2026-09-03" })],
    }),
    a,
    b,
    c,
  );
}

test("earned income: a yearly plan spread by days across months (Rs 10 a day)", () => {
  const c = run(scenarioA());
  assert.equal(month(c, "2026-04").earned.gym, 300); // 30 days
  assert.equal(month(c, "2026-05").earned.gym, 310);
  assert.equal(month(c, "2026-06").earned.gym, 300);
  assert.equal(month(c, "2026-08").earned.gym, 310);
  // Sep = A 30 x 10 + B 30 x 100 + C 11 x 100 (20th..30th)
  assert.equal(month(c, "2026-09").earned.gym, 300 + 3000 + 1100);
  // Oct so far (6 days) = A 60 + C 600
  assert.equal(month(c, "2026-10").earned.gym, 660);
  assertInvariants(c);
});

test("earned income: other income is added and total is the sum of the rounded parts", () => {
  const sep = month(run(scenarioA()), "2026-09");
  assert.equal(sep.earned.other, 200);
  assert.equal(sep.earned.total, 4600);
});

test("profit = earned - expenses, expenses by category, custom category kept", () => {
  const c = run(scenarioA());
  const sep = month(c, "2026-09");
  assert.equal(sep.expenses.total, 2600);
  assert.deepEqual(sep.expenses.byCategory, { Rent: 2000, Electricity: 500, Chai: 100 });
  assert.equal(sep.profit, 2000);
  assert.equal(month(c, "2026-08").profit, 310 - 2000);
  assert.equal(month(c, "2026-07").profit, 310 - 1000);
  assertInvariants(c);
});

test("this month is counted up to today and marked partial", () => {
  const oct = month(run(scenarioA()), "2026-10");
  assert.equal(oct.partial, true);
  assert.equal(oct.daysCounted, 6);
  assert.equal(oct.daysInMonth, 31);
  assert.equal(oct.to, "2026-10-06");
  assert.equal(oct.earned.total, 660);
  assert.equal(oct.expenses.total, 0);
  assert.equal(oct.profit, 660);
  assert.equal(month(run(scenarioA()), "2026-09").partial, false);
});

test("months before the first expense record have no data but still show income", () => {
  const c = run(scenarioA());
  assert.equal(month(c, "2026-06").hasData, false);
  assert.equal(month(c, "2026-06").earned.gym, 300);
  assert.equal(month(c, "2026-07").hasData, true);
  assert.equal(month(c, "2026-10").hasData, true);
});

test("average monthly expenses: mean of the last 3 full months with data", () => {
  const s = run(scenarioA()).snapshot;
  // (1000 + 2000 + 2600) / 3 = 1866.67 -> 1867
  assert.equal(s.avgMonthlyExpenses, 1867);
  assert.equal(s.avgBasedOnMonths, 3);
});

test("average expenses with only 1 month of data says based on 1 month", () => {
  const i = input({
    firstExpenseDate: "2026-09-02",
    expenses: [expense({ id: "e", amount: 900, date: "2026-09-02" })],
  });
  const s = run(i).snapshot;
  assert.equal(s.avgMonthlyExpenses, 900);
  assert.equal(s.avgBasedOnMonths, 1);
});

test("received money = payments by payment date (same as the Dashboard)", () => {
  const c = run(scenarioA());
  assert.equal(month(c, "2026-09").received, 4500); // 3000 + 1500
  assert.equal(month(c, "2026-10").received, 0);
});

test("received money includes old bills without payment records by bill date", () => {
  const i = input({
    bills: [
      bill({
        id: "old1",
        subtotal: 800,
        amountPaid: 800,
        paymentsTracked: false,
        invoiceDate: "2026-09-12",
      }),
    ],
    payments: [payment({ id: "p", amount: 500, paymentDate: "2026-09-13" })],
  });
  assert.equal(month(run(i), "2026-09").received, 1300);
});

test("average active members, active members per month, active today", () => {
  const c = run(scenarioA());
  const sep = month(c, "2026-09");
  assert.equal(sep.activeMembers, 3);
  // member-days: A 30 + B 30 + C 11 = 71 over 30 days = 2.3667 -> 2.37
  assert.equal(sep.avgActiveMembers, 2.37);
  const oct = month(c, "2026-10");
  assert.equal(oct.avgActiveMembers, 2); // A and C for all 6 days
  assert.equal(c.snapshot.activeMembers, 2); // A and C today
});

test("income per member and break-even members (with 'above' flag)", () => {
  const s = run(scenarioA()).snapshot;
  // 4600 / (71/30) = 1943.66 -> 1944; break-even = ceil(1867 / 1944) = 1
  assert.equal(s.incomePerMember, 1944);
  assert.equal(s.breakEvenMembers, 1);
  assert.equal(s.aboveBreakEven, true);
  assert.equal(s.health.breakEven, "good");
});

test("break-even rounds up and flags a gym below it", () => {
  // m1 pays Rs 3000 for September, renewed for October. Expenses 4000 in Jul, Aug, Sep.
  // income per member 3000, break-even = ceil(4000 / 3000) = 2, active today 1 -> below.
  const p1 = gymBilled("g1", "m1", "2026-09-01", "2026-09-30", 3000, {
    plan: { status: "expired" },
  });
  const p2 = gymBilled("g2", "m1", "2026-10-01", "2026-10-31", 3100);
  const i = withPlans(
    input({
      firstExpenseDate: "2026-07-01",
      members: [member({ id: "m1" })],
      expenses: [
        expense({ id: "a", amount: 4000, date: "2026-07-01" }),
        expense({ id: "b", amount: 4000, date: "2026-08-01" }),
        expense({ id: "c", amount: 4000, date: "2026-09-01" }),
      ],
    }),
    p1,
    p2,
  );
  const s = run(i).snapshot;
  assert.equal(s.incomePerMember, 3000);
  assert.equal(s.breakEvenMembers, 2);
  assert.equal(s.activeMembers, 1);
  assert.equal(s.aboveBreakEven, false);
  assert.equal(s.health.breakEven, "bad");
  assert.ok(s.cashWarning.on);
  assert.ok(s.cashWarning.reasons.some((r) => /break-even/i.test(r)));
});

test("break-even tone: below is bad, within 10% above is a warning, 10% or more above is good", () => {
  // n members each paid Rs 1000 for September and renewed for October. Expenses Rs 10000 a month.
  // income per member 1000, break-even = 10. 11 = +10% -> good, 10 -> warn, 9 -> bad.
  const mk = (n: number) => {
    const plans = [];
    const members = [];
    for (let k = 0; k < n; k++) {
      plans.push(
        gymBilled(`s${k}`, `m${k}`, "2026-09-01", "2026-09-30", 1000, {
          plan: { status: "expired" },
        }),
        gymBilled(`o${k}`, `m${k}`, "2026-10-01", "2026-10-31", 1000),
      );
      members.push(member({ id: `m${k}` }));
    }
    return withPlans(
      input({
        firstExpenseDate: "2026-07-01",
        members,
        expenses: [
          expense({ id: "a", amount: 10000, date: "2026-07-01" }),
          expense({ id: "b", amount: 10000, date: "2026-08-01" }),
          expense({ id: "c", amount: 10000, date: "2026-09-01" }),
        ],
      }),
      ...plans,
    );
  };
  const tone = (n: number) => run(mk(n)).snapshot;
  assert.equal(tone(10).breakEvenMembers, 10);
  assert.equal(tone(11).health.breakEven, "good");
  assert.equal(tone(10).health.breakEven, "warn");
  assert.equal(tone(9).health.breakEven, "bad");
});

test("no income and no members: income per member and break-even are 'not enough data' (null)", () => {
  const i = input({
    firstExpenseDate: "2026-09-01",
    expenses: [expense({ id: "e", amount: 500, date: "2026-09-01" })],
  });
  const s = run(i).snapshot;
  assert.equal(s.incomePerMember, null);
  assert.equal(s.breakEvenMembers, null);
  assert.equal(s.aboveBreakEven, null);
  assert.equal(s.health.breakEven, "none");
  assertInvariants(run(i));
});

test("advance money owed: paid minus used, only for plans that still run (A yearly: 3650 - 2790)", () => {
  const s = run(scenarioA()).snapshot;
  // A: paid 3650, 279 days x 10 used = 2790 -> 860. B ended. C: paid 1500, used 17 x 100 = 1700 -> 0.
  assert.equal(s.advanceOwed, 860);
});

test("advance: a paused member's paused days are not counted as used", () => {
  // Rs 1200 plan 09-01..10-12 (42 days) paid in full, 12 days paused on 09-10..09-21 -> 30 active days, Rs 40 a day.
  // Used by 10-06: 09-01..10-06 = 36 days - 12 paused = 24 -> 960. Advance 1200 - 960 = 240.
  const p = gymBilled("g1", "m1", "2026-09-01", "2026-10-12", 1200, {
    plan: { pauses: [{ on: "2026-09-10", days: 12 }] },
  });
  const i = withPlans(input({ members: [member({ id: "m1" })] }), p);
  assert.equal(run(i).snapshot.advanceOwed, 240);
});

test("advance: part-payment plan owes nothing until the payment passes the used part", () => {
  // Rs 3000 plan 09-20..10-19 paid 900: used 17 days = 1700 > 900 -> 0. Paid 2400 -> 700.
  const low = withPlans(
    input(),
    gymBilled("g1", "m1", "2026-09-20", "2026-10-19", 3000, { paid: 900 }),
  );
  assert.equal(run(low).snapshot.advanceOwed, 0);
  const high = withPlans(
    input(),
    gymBilled("g1", "m1", "2026-09-20", "2026-10-19", 3000, { paid: 2400 }),
  );
  assert.equal(run(high).snapshot.advanceOwed, 700);
});

test("advance: a plan that starts in the future is all advance, a cancelled plan is not counted", () => {
  const future = withPlans(
    input(),
    gymBilled("g1", "m1", "2026-10-10", "2026-11-08", 3000),
    gymBilled("g2", "m2", "2026-10-01", "2026-10-30", 3000, {
      plan: { status: "cancelled", cancelledOn: "2026-10-02" },
    }),
  );
  assert.equal(run(future).snapshot.advanceOwed, 3000);
});

test("cash: not set until opening money is saved", () => {
  const s = run(scenarioA()).snapshot;
  assert.equal(s.cash.set, false);
  assert.equal(s.cash.balance, null);
  assert.equal(s.cash.freeCash, null);
  assert.equal(s.cash.runwayMonths, null);
  assert.equal(s.health.cash, "none");
  assert.equal(s.health.runway, "none");
});

test("cash balance, free cash and runway after the opening date (scenario A)", () => {
  const c = run(scenarioA(), { openingBalance: 10000, openingDate: "2026-09-01" });
  const s = c.snapshot;
  // 10000 + payments 4500 (3000 + 1500; A's payment is before 09-01) + other income 200 - expenses 2600
  assert.equal(s.cash.set, true);
  assert.equal(s.cash.balance, 12100);
  assert.equal(s.cash.parts.payments, 4500);
  assert.equal(s.cash.parts.otherIncome, 200);
  assert.equal(s.cash.parts.expensesPaid, 2600);
  assert.equal(s.cash.freeCash, 12100 - 860);
  close(s.cash.runwayMonths, 6.48); // 12100 / 1867
  assert.equal(s.health.cash, "good");
  assert.equal(s.health.freeCash, "good");
  assert.equal(s.health.runway, "good");
  assertInvariants(c);
});

test("cash: every part counts only from the opening date and the right side", () => {
  const i = input({
    firstExpenseDate: "2026-08-31",
    payments: [
      payment({ id: "p0", amount: 99999, paymentDate: "2026-08-31" }), // before opening: ignored
      payment({ id: "p1", amount: 2000, paymentDate: "2026-09-05" }),
      payment({ id: "p2", amount: -500, paymentDate: "2026-09-06", kind: "refund" }),
    ],
    bills: [
      bill({
        id: "o0",
        subtotal: 5000,
        amountPaid: 5000,
        paymentsTracked: false,
        invoiceDate: "2026-08-30",
      }),
      bill({
        id: "o1",
        subtotal: 700,
        amountPaid: 700,
        paymentsTracked: false,
        invoiceDate: "2026-09-07",
      }),
    ],
    otherIncome: [income({ id: "i1", amount: 300, date: "2026-09-08" })],
    expenses: [
      expense({ id: "x0", amount: 750, date: "2026-08-31" }), // before opening: not in cash
      expense({ id: "x1", amount: 1000, date: "2026-09-09" }),
      expense({
        id: "x2",
        amount: 400,
        date: "2026-09-10",
        paidByGym: false,
        settled: true,
        settledDate: "2026-09-20",
      }),
      expense({ id: "x3", amount: 250, date: "2026-09-11", paidByGym: false, settled: false }),
    ],
    payouts: [
      payout({
        id: "t1",
        ptAssignmentId: "x",
        trainerShareAmount: 600,
        status: "paid",
        paidAt: "2026-09-15",
      }),
      payout({
        id: "t0",
        ptAssignmentId: "x",
        trainerShareAmount: 10,
        status: "paid",
        paidAt: "2026-08-31",
      }),
      payout({ id: "t2", ptAssignmentId: "x", trainerShareAmount: 150, status: "pending" }),
      payout({
        id: "t3",
        ptAssignmentId: "x",
        trainerShareAmount: -50,
        status: "pending",
        adjustment: true,
      }),
    ],
  });
  const c = run(i, { openingBalance: 10000, openingDate: "2026-09-01" });
  const p = c.snapshot.cash.parts;
  assert.equal(p.payments, 1500);
  assert.equal(p.oldBills, 700);
  assert.equal(p.otherIncome, 300);
  assert.equal(p.expensesPaid, 1400); // 1000 gym-paid + 400 staff-paid once settled
  assert.equal(p.trainerPaid, 600);
  assert.equal(p.pendingTrainer, 100); // 150 - 50
  assert.equal(p.unsettledStaffPaid, 250);
  assert.equal(c.snapshot.cash.balance, 10500);
  assert.equal(c.snapshot.cash.freeCash, 10500 - 100 - 250);
  // Aug 750, Sep 1650 -> mean 1200 -> runway 10500 / 1200 = 8.75
  assert.equal(c.snapshot.avgMonthlyExpenses, 1200);
  close(c.snapshot.cash.runwayMonths, 8.75);
  assertInvariants(c);
});

test("cash: adding one payment and one expense changes balance and runway exactly", () => {
  const base = scenarioA();
  const opening = { openingBalance: 10000, openingDate: "2026-09-01" };
  const before = run(base, opening).snapshot.cash;
  const more: CfoInput = {
    ...base,
    payments: [...base.payments, payment({ id: "new", amount: 1000, paymentDate: "2026-10-06" })],
    expenses: [
      ...base.expenses,
      expense({ id: "newx", amount: 400, date: "2026-10-06", category: "Other" }),
    ],
  };
  const after = run(more, opening).snapshot.cash;
  assert.equal(after.balance! - before.balance!, 600);
});

test("cash: money paid in the old software counts as received on its day, never as cash here", () => {
  const base = scenarioA();
  const opening = { openingBalance: 10000, openingDate: "2026-09-01" };
  const before = run(base, opening);
  const more: CfoInput = {
    ...base,
    payments: [
      ...base.payments,
      payment({ id: "old1", amount: 5800, paymentDate: "2026-09-12", oldSoftware: true }),
    ],
  };
  const after = run(more, opening);
  assert.equal(after.snapshot.cash.balance, before.snapshot.cash.balance);
  assert.equal(month(after, "2026-09").received - month(before, "2026-09").received, 5800);
});

test("cash: opening date today and in the future do not break anything", () => {
  const c = run(scenarioA(), { openingBalance: 500, openingDate: "2026-10-06" });
  assert.equal(c.snapshot.cash.balance, 500);
  assertInvariants(c);
});

test("runway: money that has run out is 0 months with a warning; no expenses means unknown", () => {
  const gone = run(
    input({
      firstExpenseDate: "2026-09-01",
      expenses: [expense({ id: "e", amount: 5000, date: "2026-09-01" })],
    }),
    { openingBalance: -100, openingDate: "2026-10-01" },
  );
  assert.equal(gone.snapshot.cash.runwayMonths, 0);
  assert.equal(gone.snapshot.health.cash, "bad");
  assert.equal(gone.snapshot.health.runway, "bad");
  assert.ok(gone.snapshot.cashWarning.on);
  assert.ok(gone.snapshot.cashWarning.reasons.some((r) => /run out/i.test(r)));

  const noExp = run(input(), { openingBalance: 5000, openingDate: "2026-10-01" });
  assert.equal(noExp.snapshot.cash.runwayMonths, null);
  assert.equal(noExp.snapshot.health.runway, "none");
});

test("runway below the warning limit raises the cash warning", () => {
  // expenses 10000 a month for 3 months, cash 15000 -> 1.5 months < 2.
  const i = input({
    firstExpenseDate: "2026-07-01",
    expenses: [
      expense({ id: "a", amount: 10000, date: "2026-07-01" }),
      expense({ id: "b", amount: 10000, date: "2026-08-01" }),
      expense({ id: "c", amount: 10000, date: "2026-09-01" }),
    ],
  });
  const s = run(i, { openingBalance: 15000, openingDate: "2026-10-01" }).snapshot;
  close(s.cash.runwayMonths, 1.5);
  assert.equal(s.health.runway, "bad");
  assert.equal(s.cashWarning.on, true);
  const ok = run(i, { openingBalance: 25000, openingDate: "2026-10-01" }).snapshot;
  close(ok.cash.runwayMonths, 2.5);
  assert.equal(ok.health.runway, "warn"); // below 2 x 2 months
  assert.equal(ok.cashWarning.on, false);
});

test("free cash: below zero is a problem, below one month of expenses is a warning", () => {
  const i = input({
    firstExpenseDate: "2026-07-01",
    expenses: [
      expense({ id: "a", amount: 1000, date: "2026-07-01" }),
      expense({ id: "b", amount: 1000, date: "2026-08-01" }),
      expense({ id: "c", amount: 1000, date: "2026-09-01" }),
    ],
    payouts: [payout({ id: "t", ptAssignmentId: "x", trainerShareAmount: 800, status: "pending" })],
  });
  // cash 1500 - pending trainer 800 = 700 < 1000 (one month) -> warn
  assert.equal(
    run(i, { openingBalance: 1500, openingDate: "2026-10-01" }).snapshot.health.freeCash,
    "warn",
  );
  // cash 500 - 800 = -300 -> bad
  assert.equal(
    run(i, { openingBalance: 500, openingDate: "2026-10-01" }).snapshot.health.freeCash,
    "bad",
  );
  // cash 5000 - 800 = 4200 -> good
  assert.equal(
    run(i, { openingBalance: 5000, openingDate: "2026-10-01" }).snapshot.health.freeCash,
    "good",
  );
});

test("profit tone: last full month decides (good above 0, bad below 0, none without expense data)", () => {
  const c = run(scenarioA()).snapshot;
  assert.equal(c.health.profit, "good"); // Sep profit 2000
  const loss = run(
    input({
      firstExpenseDate: "2026-09-01",
      expenses: [expense({ id: "e", amount: 500, date: "2026-09-01" })],
    }),
  ).snapshot;
  assert.equal(loss.health.profit, "bad");
  assert.equal(run(input()).snapshot.health.profit, "none");
});

/* --------------------------------------------------------- renewals, growth, dues */

/**
 * August scenario. Grace 15 days, today 10-06.
 *  E  plan 07-20..08-20, never renewed                       -> not renewed
 *  F  plan 07-26..08-25, renewed 08-26..09-24                -> renewed
 *  G  plan 08-01..08-31, renewed 09-10..10-09 (within grace)  -> renewed
 *  H  plan 08-01..08-31 cancelled on 08-10, nothing else      -> left early
 *  I  plan 07-15..09-10 and a second plan cancelled 08-12     -> not left early (first plan covers)
 *  J  joined 08-15, plan 08-15..09-14                         -> new, not ended in Aug
 */
function augustScenario(): CfoInput {
  const p = (...a: Parameters<typeof gymBilled>) => gymBilled(...a);
  return withPlans(
    input({
      members: [
        member({ id: "E", joinedOn: "2026-08-05" }),
        member({ id: "F", joinedOn: "2026-07-26" }),
        member({ id: "G", joinedOn: "2026-06-01" }),
        member({ id: "H", joinedOn: "2026-08-01" }),
        member({ id: "I", joinedOn: "2026-07-15" }),
        member({ id: "J", joinedOn: "2026-08-15" }),
      ],
    }),
    p("e1", "E", "2026-07-20", "2026-08-20", 1000, { plan: { status: "expired" } }),
    p("f1", "F", "2026-07-26", "2026-08-25", 1000, { plan: { status: "expired" } }),
    p("f2", "F", "2026-08-26", "2026-09-24", 1000, { plan: { status: "expired" } }),
    p("g1", "G", "2026-08-01", "2026-08-31", 1000, { plan: { status: "expired" } }),
    p("g2", "G", "2026-09-10", "2026-10-09", 1000),
    p("h1", "H", "2026-08-01", "2026-08-31", 1000, {
      plan: { status: "cancelled", cancelledOn: "2026-08-10", cancelId: "ch" },
    }),
    p("i1", "I", "2026-07-15", "2026-09-10", 1000, { plan: { status: "expired" } }),
    p("i2", "I", "2026-08-05", "2026-09-04", 1000, {
      plan: { status: "cancelled", cancelledOn: "2026-08-12", cancelId: "ci" },
    }),
    p("j1", "J", "2026-08-15", "2026-09-14", 1000, { plan: { status: "expired" } }),
  );
}

test("renewal rate: renewed / (renewed + not renewed), still-deciding left out", () => {
  const aug = month(run(augustScenario()), "2026-08");
  // ended in Aug: E, F(f1), G(g1) = 3. renewed F and G, not renewed E.
  assert.equal(aug.plansEnded, 3);
  assert.equal(aug.renewed, 2);
  assert.equal(aug.notRenewed, 1);
  assert.equal(aug.stillDeciding, 0);
  close(aug.renewalRate, 2 / 3);
});

test("renewal: a plan inside the grace period is still deciding, not counted either way", () => {
  // Sep: f2 ends 09-24 (+15 = 10-09, after today) -> deciding. i1 ends 09-10 (+15 = 09-25) -> not renewed.
  // j1 ends 09-14 (+15 = 09-29) -> not renewed.
  const sep = month(run(augustScenario()), "2026-09");
  assert.equal(sep.stillDeciding, 1);
  assert.equal(sep.notRenewed, 2);
  assert.equal(sep.renewed, 0);
  assert.equal(sep.renewalRate, 0);
});

test("renewal rate is null when nobody's plan ended", () => {
  assert.equal(month(run(augustScenario()), "2026-04").renewalRate, null);
});

test("left early: cancelled plan with nothing covering the cancel day; not when another plan covers", () => {
  const aug = month(run(augustScenario()), "2026-08");
  assert.equal(aug.leftEarly, 1); // H only; I has a running plan
});

test("new members and net growth (each member counted once)", () => {
  const aug = month(run(augustScenario()), "2026-08");
  // joined in Aug: E, H, J = 3. net = 3 - 1 (not renewed E) - 1 (left early H) = 1
  assert.equal(aug.newMembers, 3);
  assert.equal(aug.netGrowth, 1);
});

test("new members: people whose every plan is old software or imported are not 'new'", () => {
  const i = input({
    members: [
      member({ id: "x", joinedOn: "2026-09-10" }),
      member({ id: "y", joinedOn: "2026-09-11" }),
    ],
    gymPlans: [gym({ id: "gx", clientId: "x", imported: true, invoiceId: null, listPrice: 500 })],
  });
  const j = withPlans(i, gymBilled("gy", "y", "2026-09-11", "2026-10-10", 1000));
  assert.equal(month(run(j), "2026-09").newMembers, 1);
});

test("a member who is both not renewed and left early in one month is counted once", () => {
  // K: plan k1 08-01..08-20 (not renewed), plan k2 08-05..08-28 cancelled 08-25 (nothing covers 08-25 after k1 ends).
  const i = withPlans(
    input({ members: [member({ id: "K", joinedOn: "2026-01-01" })] }),
    gymBilled("k1", "K", "2026-08-01", "2026-08-20", 1000, { plan: { status: "expired" } }),
    gymBilled("k2", "K", "2026-08-05", "2026-08-28", 1000, {
      plan: { status: "cancelled", cancelledOn: "2026-08-25", cancelId: "ck" },
    }),
  );
  const aug = month(run(i), "2026-08");
  assert.equal(aug.notRenewed, 1);
  assert.equal(aug.leftEarly, 0);
  assert.equal(aug.netGrowth, -1);
});

test("pending dues: groups by how late, total is the sum, refunded/closed/zero bills left out", () => {
  const mk = (
    id: string,
    balance: number,
    due: string,
    extra: Partial<Parameters<typeof bill>[0]> = {},
  ) =>
    bill({
      id,
      clientId: "c1",
      subtotal: balance,
      amountPaid: 0,
      dueDate: due,
      invoiceDate: "2026-09-01",
      ...extra,
    });
  const i = input({
    members: [member({ id: "c1", name: "Asha Rao", code: "12" })],
    bills: [
      mk("d1", 100, "2026-10-10"), // 4 days to go -> not due yet
      mk("d2", 200, "2026-10-06"), // due today -> 0 late
      mk("d3", 300, "2026-09-29"), // 7 late
      mk("d4", 400, "2026-09-28"), // 8 late
      mk("d5", 500, "2026-09-06"), // 30 late
      mk("d6", 600, "2026-09-05"), // 31 late
      mk("d7", 700, ""), // no pay-by date: from bill date 09-01 = 35 late
      mk("d8", 800, "2026-09-01", { status: "refunded" }),
      mk("d9", 900, "2026-09-01", { status: "closed" }),
      bill({ id: "d10", subtotal: 100, amountPaid: 100, dueDate: "2026-09-01" }),
    ],
  });
  const c = run(i);
  const d = c.snapshot.dues;
  assert.equal(d.count, 7);
  assert.equal(d.total, 2800);
  assert.deepEqual(d.groups.notDue, { count: 1, amount: 100 });
  assert.deepEqual(d.groups.d0_7, { count: 2, amount: 500 });
  assert.deepEqual(d.groups.d8_30, { count: 2, amount: 900 });
  assert.deepEqual(d.groups.d30plus, { count: 2, amount: 1300 });
  // rows sorted by amount, biggest first
  assert.deepEqual(
    c.lists.dues.rows.map((r) => r.balance),
    [700, 600, 500, 400, 300, 200, 100],
  );
  assert.equal(c.lists.dues.rows[0]!.name, "Asha Rao"); // the member record is used
  assert.equal(c.lists.dues.rows[0]!.code, "12");
  assert.equal(c.lists.dues.rows[0]!.daysLate, 35);
  assert.equal(c.lists.dues.rows[6]!.daysLate, -4);
  assert.equal(c.lists.dues.rows[0]!.group, "d30plus");
  assertInvariants(c);
});

test("pending dues in scenario A: one bill, 11 days late", () => {
  const c = run(scenarioA());
  assert.equal(c.snapshot.dues.count, 1);
  assert.equal(c.snapshot.dues.total, 1500);
  assert.equal(c.snapshot.dues.groups.d8_30.amount, 1500);
});

/* -------------------------------------------------------------------------- PT */

test("PT income is counted as the gym's share; trainer share is not income or an expense", () => {
  // PT Rs 3000 for September, trainer share Rs 900 -> gym keeps 2100.
  const i = input({
    firstExpenseDate: "2026-09-01",
    expenses: [expense({ id: "e", amount: 1000, date: "2026-09-01" })],
    ptPlans: [pt({ id: "p1", listPrice: 3000, startDate: "2026-09-01", endDate: "2026-09-30" })],
    bills: [bill({ id: "b-p1", subtotal: 3000, ptAssignmentId: "p1", ptGross: 3000 })],
    payouts: [payout({ id: "po", ptAssignmentId: "p1", trainerShareAmount: 900 })],
    trainers: [trainer({ id: "t1", name: "Coach One", monthlySalary: 5000 })],
    members: [member({ id: "c1" })],
  });
  const c = run(i);
  const sep = month(c, "2026-09");
  assert.equal(sep.ptIncome, 3000);
  assert.equal(sep.trainerShare, 900);
  assert.equal(sep.earned.pt, 2100);
  assert.equal(sep.earned.total, 2100);
  assert.equal(sep.expenses.total, 1000);
  assert.equal(sep.profit, 1100);
  const row = c.snapshot.trainers[0]!;
  assert.equal(row.trainerId, "t1");
  assert.deepEqual(row.lastMonth, { income: 3000, trainerShare: 900, gymKeeps: 2100 });
  assert.deepEqual(row.thisMonth, { income: 0, trainerShare: 0, gymKeeps: 0 });
  assert.equal(row.monthlySalary, 5000);
  assertInvariants(c);
});

test("PT: cancelled PT plan with a refund keeps the cancel math (income 500, trainer 150)", () => {
  const i = input({
    ptPlans: [
      pt({
        id: "p1",
        listPrice: 1000,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        status: "cancelled",
        cancelledOn: "2026-09-05",
        cancelId: "cx",
      }),
    ],
    bills: [bill({ id: "b-p1", subtotal: 1000, ptAssignmentId: "p1", ptGross: 1000 })],
    payments: [payment({ id: "r", amount: -500, kind: "refund", cancelId: "cx" })],
    payouts: [
      payout({ id: "po", ptAssignmentId: "p1", trainerShareAmount: 150, originalShare: 300 }),
    ],
  });
  const sep = month(run(i), "2026-09");
  assert.equal(sep.ptIncome, 500);
  assert.equal(sep.trainerShare, 150);
  assert.equal(sep.earned.pt, 350);
});

test("orphan bill lands on the bill date in the right month and in the data notes", () => {
  const i = input({
    bills: [
      bill({
        id: "ob",
        subtotal: 1000,
        membershipId: "gone-g",
        ptAssignmentId: "gone-p",
        membershipGross: 800,
        ptGross: 200,
        invoiceDate: "2026-09-05",
      }),
    ],
    payouts: [payout({ id: "po1", ptAssignmentId: "gone-p", trainerShareAmount: 80 })],
  });
  const c = run(i);
  const sep = month(c, "2026-09");
  assert.equal(sep.earned.gym, 800);
  assert.equal(sep.ptIncome, 200);
  assert.equal(sep.trainerShare, 80);
  assert.equal(sep.earned.pt, 120);
  assert.ok(c.snapshot.dataNotes.some((n) => /no longer exist/.test(n)));
});

/* ---------------------------------------------------------------- edge cases */

test("rounding: each month's leaf is rounded once (Rs 100 over 3 days splits 67 + 33)", () => {
  const i = withPlans(input(), gymBilled("g1", "m1", "2026-09-29", "2026-10-01", 100));
  const c = run(i);
  assert.equal(month(c, "2026-09").earned.gym, 67); // 66.67
  assert.equal(month(c, "2026-10").earned.gym, 33); // 33.33
  assertInvariants(c);
});

test("February: 28 days, last full month in March", () => {
  // today 2027-03-10: months Sep 2026 .. Mar 2027, Feb 2027 is the last full month.
  const p = gymBilled("g1", "m1", "2027-01-01", "2027-03-31", 900); // 90 days -> Rs 10 a day
  const i = withPlans(
    input({ today: "2027-03-10", windowStart: "2026-09-01", members: [member({ id: "m1" })] }),
    p,
  );
  const c = run(i);
  const feb = month(c, "2027-02");
  assert.equal(feb.daysInMonth, 28);
  assert.equal(feb.earned.gym, 280);
  assert.equal(feb.avgActiveMembers, 1);
  assert.equal(c.snapshot.lastMonthKey, "2027-02");
  assert.equal(c.snapshot.thisMonthKey, "2027-03");
  assert.equal(month(c, "2027-01").earned.gym, 310);
  assert.equal(month(c, "2027-03").earned.gym, 100); // 10 days
});

test("a brand-new gym with no data at all gives finite, empty numbers", () => {
  const c = run(input());
  const s = c.snapshot;
  assert.equal(s.months.length, 7);
  assert.equal(s.activeMembers, 0);
  assert.equal(s.avgMonthlyExpenses, null);
  assert.equal(s.avgBasedOnMonths, 0);
  assert.equal(s.incomePerMember, null);
  assert.equal(s.breakEvenMembers, null);
  assert.equal(s.advanceOwed, 0);
  assert.equal(s.dues.count, 0);
  assert.equal(c.lists.atRisk.count, 0);
  assert.ok(s.dataNotes.length >= 1);
  assertInvariants(c);
});

test("a plan with a missing end date puts all its money on the start day and is noted", () => {
  const i = withPlans(
    input({ plansMissingEndDate: 1 }),
    gymBilled("g1", "m1", "2026-09-03", "", 1200),
  );
  const c = run(i);
  assert.equal(month(c, "2026-09").earned.gym, 1200);
  assert.ok(c.snapshot.dataNotes.some((n) => /end date/.test(n)));
  assertInvariants(c);
});

test("data notes never contain a name, phone or id", () => {
  const i = input({
    members: [member({ id: "x", name: "Zebulon Quirk", phone: "9123456789" })],
    gymPlans: [gym({ id: "g1", clientId: "x", invoiceId: "gone" })],
  });
  for (const n of run(i).snapshot.dataNotes) {
    assert.ok(!/Zebulon|Quirk|9123456789/.test(n), n);
  }
});

test("bad numbers (NaN, Infinity) in the data never reach the snapshot", () => {
  const i = input({
    firstExpenseDate: "2026-09-01",
    expenses: [expense({ id: "e", amount: Number.NaN, date: "2026-09-01" })],
    payments: [payment({ id: "p", amount: Infinity, paymentDate: "2026-09-02" })],
    otherIncome: [income({ id: "i", amount: -Infinity, date: "2026-09-03" })],
    bills: [
      bill({
        id: "b",
        subtotal: 100,
        amountPaid: Number.NaN,
        balanceDue: Number.NaN,
        dueDate: "2026-09-01",
      }),
    ],
  });
  assertInvariants(run(i, { openingBalance: 100, openingDate: "2026-09-01" }));
});

test("computeCfo is deterministic and stamps who and when", () => {
  const a = run(scenarioA());
  const b = run(scenarioA());
  assert.deepEqual(a, b);
  assert.equal(a.snapshot.computedAt, META.computedAt);
  assert.equal(a.snapshot.computedBy, "test");
  assert.equal(a.snapshot.version, 1);
  assert.equal(a.snapshot.currency, "INR");
  assert.equal(a.snapshot.today, "2026-10-06");
});

test("scenario invariants hold on every month of every scenario", () => {
  for (const i of [scenarioA(), augustScenario()]) assertInvariants(run(i));
});

test("free cash: the trainer's part of prepaid PT is not taken off twice (6000 PT, 3000 share -> 0)", () => {
  // Opening 0 at the start of 6 Oct. A PT plan sold that day for 6000, paid in full, starts
  // tomorrow; the trainer's share is 3000. Either 3000 goes to the trainer (or comes back from
  // them on a refund) and 3000 is the gym's unearned part: nothing is really the gym's yet.
  const base = {
    ptPlans: [
      pt({
        id: "p1",
        startDate: "2026-10-07",
        endDate: "2026-11-05",
        listPrice: 6000,
        trainerShareAmount: 3000,
      }),
    ],
    bills: [
      bill({
        id: "b-p1",
        subtotal: 6000,
        amountPaid: 6000,
        ptAssignmentId: "p1",
        ptGross: 6000,
        invoiceDate: "2026-10-06",
      }),
    ],
    payments: [payment({ id: "pay1", amount: 6000, paymentDate: "2026-10-06", invoiceId: "b-p1" })],
  };
  const pending = run(
    input({
      ...base,
      payouts: [
        payout({
          id: "o1",
          ptAssignmentId: "p1",
          trainerShareAmount: 3000,
          status: "pending",
          paidAt: null,
        }),
      ],
    }),
    { openingBalance: 0, openingDate: "2026-10-06" },
  ).snapshot;
  assert.equal(pending.cash.balance, 6000);
  assert.equal(pending.advanceOwed, 6000);
  assert.equal(pending.cash.parts.trainerShareInAdvance, 3000);
  assert.equal(pending.cash.freeCash, 0); // 6000 - 6000 + 3000 - 3000 pending
  const paid = run(
    input({
      ...base,
      payouts: [
        payout({
          id: "o1",
          ptAssignmentId: "p1",
          trainerShareAmount: 3000,
          status: "paid",
          paidAt: "2026-10-06",
        }),
      ],
    }),
    { openingBalance: 0, openingDate: "2026-10-06" },
  ).snapshot;
  assert.equal(paid.cash.balance, 3000);
  assert.equal(paid.cash.freeCash, 0); // 3000 - 6000 + 3000 - 0
});

test("renewal: a shorter plan that cut short a longer one is not a renewal (Sep: 1 ended, 0 renewed, 1 still deciding)", () => {
  // A runs 1 Aug-1 Dec but was cut short (expired) by B, 1-30 Sep, made from 'Create bill'.
  // Today (6 Oct) the member has no plan: September's B ended and nothing renewed it.
  const A = gymBilled("A", "c1", "2026-08-01", "2026-12-01", 12000, {
    plan: { status: "expired" },
  });
  const B = gymBilled("B", "c1", "2026-09-01", "2026-09-30", 1000, { plan: { status: "expired" } });
  const s = run(
    withPlans(input({ members: [member({ id: "c1" })], firstExpenseDate: "2026-04-01" }), A, B),
  ).snapshot;
  const sep = s.months.find((m) => m.key === "2026-09")!;
  assert.equal(s.activeMembers, 0);
  assert.equal(sep.plansEnded, 1);
  assert.equal(sep.renewed, 0); // was 1 before: A "renewed" B although A was cut short by B
  assert.equal(sep.stillDeciding, 1); // 30 Sep + 15 days grace is after today
});
