import assert from "node:assert/strict";
import { test } from "node:test";
import { planMoney, planSoldFor, type PlanBill } from "./plan-money.ts";

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
