import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billSharePaid,
  planMoney,
  planSoldFor,
  refundLimit,
  type PlanBill,
  type RefundBill,
  type RefundPlan,
} from "./plan-money.ts";

const bill = (over: Partial<PlanBill> = {}): PlanBill => ({
  subtotal: 1999,
  discount: 300,
  total: 1699,
  amountPaid: 1699,
  balanceDue: 0,
  membershipGross: 1999,
  ptGross: 0,
  ...over,
});

test("the reported case: package ₹1,999, ₹300 discount → ₹1,699, as in the money list", () => {
  assert.deepEqual(planMoney("gym", 1999, bill()), {
    price: 1999,
    discount: 300,
    credit: 0,
    value: 1699,
    total: 1699,
    paid: 1699,
    due: 0,
    shared: false,
  });
});

test("part paid: what is paid and what is still due", () => {
  const m = planMoney("gym", 1999, bill({ amountPaid: 1000, balanceDue: 699 }))!;
  assert.equal(m.total, 1699);
  assert.equal(m.paid, 1000);
  assert.equal(m.due, 699);
});

test("no bill: nothing to read (the page shows the package price)", () => {
  assert.equal(planMoney("gym", 1999, null), null);
  assert.equal(planMoney("gym", 1999, bill({ subtotal: 0 })), null);
});

test("gym + PT on one bill share the discount and payments by price", () => {
  // ₹2,500 gym + ₹12,000 PT − ₹2,500 discount = ₹12,000, all paid.
  const b = bill({
    subtotal: 14500,
    discount: 2500,
    total: 12000,
    amountPaid: 12000,
    membershipGross: 2500,
    ptGross: 12000,
  });
  const gym = planMoney("gym", 2500, b)!;
  const pt = planMoney("pt", 12000, b)!;
  assert.equal(gym.shared, true);
  assert.equal(gym.discount, 431.03);
  assert.equal(pt.discount, 2068.97);
  assert.equal(gym.paid, 2068.97);
  assert.equal(pt.paid, 9931.03);
  assert.equal(Math.round((gym.total + pt.total) * 100) / 100, 12000);
});

test("an upgrade's credit is not a discount: value = price − discount, total after credit", () => {
  // ₹5,999 plan, ₹1,302 credit for the old plan's unused days, ₹200 discount.
  const m = planMoney(
    "gym",
    5999,
    bill({
      subtotal: 5999,
      discount: 1502,
      total: 4497,
      amountPaid: 4497,
      membershipGross: 5999,
      upgradeCredit: 1302,
    }),
  )!;
  assert.equal(m.discount, 200);
  assert.equal(m.credit, 1302);
  assert.equal(m.value, 5799);
  assert.equal(m.total, 4497);
});

test("money paid in the old software on the bill is a credit, not a discount", () => {
  const m = planMoney(
    "gym",
    7000,
    bill({
      subtotal: 7000,
      discount: 5800,
      total: 1200,
      amountPaid: 0,
      balanceDue: 1200,
      membershipGross: 7000,
      oldSoftwareCredit: 5800,
    }),
  )!;
  assert.equal(m.discount, 0);
  assert.equal(m.credit, 5800);
  assert.equal(m.value, 7000);
  assert.equal(m.due, 1200);
});

test("upgrade credit base: what the member paid for the plan", () => {
  assert.equal(planSoldFor("gym", { price: 1999 }, bill()), 1699);
  assert.equal(planSoldFor("gym", { price: 1999 }, null), 1999);
  assert.equal(
    planSoldFor(
      "gym",
      { price: 7000, paidInOldSoftware: true, oldSoftwarePaid: 5800, oldSoftwareBalance: 200 },
      null,
    ),
    6000,
  );
  assert.equal(planSoldFor("gym", { price: 7000, paidInOldSoftware: true }, null), 7000);
});

test("a sale here later marked 'paid in the old software': the whole plan, not just the old part", () => {
  // ₹2,000 plan: ₹500 paid in the old software (a credit on the bill), ₹1,500 paid here.
  const part = bill({
    subtotal: 2000,
    discount: 500,
    total: 1500,
    amountPaid: 1500,
    membershipGross: 2000,
    oldSoftwareCredit: 500,
  });
  const plan = { price: 2000, paidInOldSoftware: true, oldSoftwarePaid: 500 };
  assert.equal(planSoldFor("gym", plan, part), 2000);
  // The whole entry: the old deal ₹2,000, ₹1,500 paid there, ₹500 still owed here.
  const whole = bill({
    subtotal: 2000,
    discount: 1500,
    total: 500,
    amountPaid: 0,
    balanceDue: 500,
    membershipGross: 2000,
    oldSoftwareCredit: 1500,
  });
  assert.equal(planSoldFor("gym", { ...plan, oldSoftwarePaid: 1500 }, whole), 2000);
});

/* ------------------------------------------------------------------------- refundLimit */

const gymPlan = (over: Partial<RefundPlan> = {}): RefundPlan => ({
  id: "g1",
  kind: "gym",
  price: 5000,
  startDate: "2026-09-01",
  ...over,
});
const ptPlan = (over: Partial<RefundPlan> = {}): RefundPlan => ({
  id: "p1",
  kind: "pt",
  price: 12000,
  startDate: "2026-09-01",
  ...over,
});
const rbill = (over: Partial<RefundBill> = {}): RefundBill => ({
  membershipId: "g1",
  ptAssignmentId: null,
  subtotal: 5000,
  amountPaid: 5000,
  membershipGross: 5000,
  ptGross: 0,
  ...over,
});

test("audit 5: an old plan with no bill here is capped at what was paid in the old software", () => {
  const plan = gymPlan({ paidInOldSoftware: true, oldSoftwarePaid: 5000 });
  assert.equal(refundLimit([plan], [], []).max, 5000);
});

test("old money is read from its payment record when there is one (not counted twice)", () => {
  const plan = gymPlan({ paidInOldSoftware: true, oldSoftwarePaid: 5000 });
  const doc = { amount: 4500, oldSoftware: true, membershipId: "g1", ptAssignmentId: null };
  assert.equal(refundLimit([plan], [], [doc]).max, 4500);
});

test("old plan with a balance bill: old money + what was collected on the balance here", () => {
  const plan = gymPlan({ paidInOldSoftware: true, oldSoftwarePaid: 4000 });
  const bill = rbill({ subtotal: 1000, amountPaid: 600, membershipGross: 1000 });
  const r = refundLimit([plan], [bill], []);
  assert.deepEqual(r, { here: 600, old: 4000, refunded: 0, max: 4600 });
});

test("a gym + PT pair from the old software counts its shared money once", () => {
  const g = gymPlan({ paidInOldSoftware: true, oldSoftwarePaid: 15000 });
  const p = ptPlan({ paidInOldSoftware: true, oldSoftwarePaid: 15000 });
  assert.equal(refundLimit([g, p], [], []).old, 15000);
  const doc = { amount: 15000, oldSoftware: true, membershipId: "g1", ptAssignmentId: "p1" };
  assert.equal(refundLimit([g, p], [], [doc]).old, 15000);
});

test("a gym + PT balance bill (all of it on gym) is not counted for the PT plan too", () => {
  const bill = rbill({
    ptAssignmentId: "p1",
    subtotal: 2000,
    amountPaid: 2000,
    membershipGross: 2000,
  });
  assert.equal(billSharePaid("gym", 5000, bill), 2000);
  assert.equal(billSharePaid("pt", 12000, bill), 0);
  const g = gymPlan({ paidInOldSoftware: true, oldSoftwarePaid: 0 });
  const p = ptPlan({ paidInOldSoftware: true, oldSoftwarePaid: 0 });
  assert.equal(refundLimit([g, p], [bill], []).max, 2000);
});

test("a sale here: its bill's share, less refunds already given for it", () => {
  const bill = rbill({
    ptAssignmentId: "p1",
    subtotal: 14500,
    amountPaid: 12000,
    membershipGross: 2500,
    ptGross: 12000,
  });
  const refund = { amount: -1000, membershipId: "g1", ptAssignmentId: null };
  const other = { amount: -700, membershipId: "x", ptAssignmentId: null };
  const r = refundLimit([gymPlan()], [bill], [refund, other]);
  assert.deepEqual(r, { here: 2069, old: 0, refunded: 1000, max: 1069 });
});

test("a plan with no bill and nothing from the old software counts at its price", () => {
  assert.equal(refundLimit([gymPlan()], [rbill({ membershipId: "other" })], []).max, 5000);
});

test("a bill without the gym/PT split falls back to the price", () => {
  const bill = rbill({ membershipGross: 0, ptGross: 0, subtotal: 5000, amountPaid: 2500 });
  assert.equal(billSharePaid("gym", 5000, bill), 2500);
});

test("planMoney: after a PT on a gym + PT bill is cancelled, all that is due is the gym plan's", () => {
  const b: PlanBill = {
    subtotal: 14500,
    discount: 0,
    total: 14500,
    amountPaid: 5000,
    balanceDue: 1638,
    membershipGross: 2500,
    ptGross: 12000,
    cancelledParts: { c1: { kind: "pt", amount: 7862 } },
  };
  assert.equal(planMoney("gym", 2500, b)?.due, 1638);
  assert.equal(planMoney("pt", 12000, b)?.due, 0);
  // Nothing cancelled: shared by price, as before.
  assert.equal(
    planMoney("pt", 12000, { ...b, cancelledParts: null, balanceDue: 9500 })?.due,
    7862.07,
  );
});

test("a PT discount (its line already lower) shows as the plan's discount: package ₹6,000 · ₹1,000", () => {
  const b = bill({
    subtotal: 7499,
    discount: 0,
    total: 7499,
    amountPaid: 7499,
    membershipGross: 2499,
    ptGross: 5000,
  });
  const m = planMoney("pt", 5000, b, 1000)!;
  assert.equal(m.price, 6000);
  assert.equal(m.discount, 1000);
  assert.equal(m.value, 5000);
  assert.equal(m.total, 5000);
  assert.equal(m.paid, 5000);
  // The gym plan on the same bill is unaffected.
  assert.equal(planMoney("gym", 2499, b)!.total, 2499);
});
