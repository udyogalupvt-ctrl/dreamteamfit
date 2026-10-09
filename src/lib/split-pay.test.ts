import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billModes,
  billModesLabel,
  scaleAllocation,
  shareOut,
  splitParts,
  splitProblem,
} from "./split-pay.ts";

test("₹300 PhonePe + ₹1,500 cash: UPI part first, then cash", () => {
  assert.deepEqual(splitParts(1800, 1500), [
    { method: "UPI", amount: 300 },
    { method: "Cash", amount: 1500 },
  ]);
  assert.deepEqual(splitParts(1999.5, 1000), [
    { method: "UPI", amount: 999.5 },
    { method: "Cash", amount: 1000 },
  ]);
});

test("paise: cash rounded first, the parts always add up, no ₹0 part", () => {
  assert.match(splitProblem(1800, 0.004), /cash part/i);
  assert.match(splitProblem(1800, 1799.995), /less than/i);
  const [u, c] = splitParts(1000, 0.125);
  assert.equal(u!.amount + c!.amount, 1000);
  assert.equal(c!.amount, 0.13);
});

test("both parts must be above ₹0", () => {
  assert.equal(splitProblem(1800, 1500), "");
  assert.match(splitProblem(0, 0), /amount/i);
  assert.match(splitProblem(1800, 0), /cash part/i);
  assert.match(splitProblem(1800, NaN), /cash part/i);
  assert.match(splitProblem(1800, 1800), /less than/i);
  assert.match(splitProblem(1800, 2000), /less than/i);
});

test("the second part gets what is left of one payment's allocation, so the pair adds up exactly", () => {
  const whole = { trainerShareAmount: 1166.67, gymAmount: 2166.66, membershipGymAmount: 0 };
  const first = { trainerShareAmount: 194.44, gymAmount: 361.11, membershipGymAmount: 0 };
  assert.deepEqual(shareOut(whole, first)[1], {
    trainerShareAmount: 972.23,
    gymAmount: 1805.55,
    membershipGymAmount: 0,
  });
});

test("splitting a saved payment: the first part's share by its size, gym = amount − trainer", () => {
  const whole = {
    trainerShareAmount: 1750,
    gymAmount: 3250,
    membershipGymAmount: 0,
    ptGymAmount: 3250,
    otherGymAmount: 0,
  };
  const first = scaleAllocation(whole, 5000, 1000);
  assert.deepEqual(first, {
    trainerShareAmount: 350,
    gymAmount: 650,
    membershipGymAmount: 0,
    ptGymAmount: 650,
    otherGymAmount: 0,
  });
  const second = shareOut(whole, first)[1];
  assert.equal(second.trainerShareAmount + first.trainerShareAmount, 1750);
  assert.equal(second.gymAmount, 4000 - second.trainerShareAmount);
  // Paise: thirds still add up exactly and keep gym = amount − trainer on each part.
  const odd = { ...whole, trainerShareAmount: 1000, gymAmount: 1000, ptGymAmount: 1000 };
  const a = scaleAllocation(odd, 2000, 666.67);
  assert.equal(a.trainerShareAmount, 333.34);
  assert.equal(a.gymAmount, 333.33);
  const b = shareOut(odd, a)[1];
  assert.equal(b.trainerShareAmount, 666.66);
  assert.equal(b.gymAmount, 666.67);
  assert.equal(scaleAllocation(odd, 0, 0).gymAmount, 0);
});

test("a paisa of rounding never leaves a part below ₹0 (membership + PT bill, ₹1 + ₹2,999)", () => {
  const whole = {
    trainerShareAmount: 700,
    gymAmount: 2300,
    membershipGymAmount: 1000,
    ptGymAmount: 1300,
    otherGymAmount: 0,
  };
  const first = { ...scaleAllocation(whole, 3000, 1), otherGymAmount: 0.01 };
  const [a, b] = shareOut(whole, first);
  for (const k of Object.keys(whole) as (keyof typeof whole)[]) {
    assert.ok(b[k] >= 0, `${k} ${b[k]}`);
    assert.equal(Math.round((a[k] + b[k]) * 100) / 100, whole[k]);
  }
  // A payment saved without a money split (all 0): the parts get 0 too, never below.
  const none = {
    trainerShareAmount: 0,
    gymAmount: 0,
    membershipGymAmount: 0,
    ptGymAmount: 0,
    otherGymAmount: 0,
  };
  const [x, y] = shareOut(none, scaleAllocation(none, 1800, 300));
  assert.equal(x.gymAmount + y.gymAmount, 0);
  assert.ok(y.gymAmount >= 0);
});

test("bill modes: the bigger part's mode, both listed; one part = no list", () => {
  assert.deepEqual(
    billModes([
      { method: "UPI", amount: 300 },
      { method: "Cash", amount: 1500 },
    ]),
    { paymentMethod: "Cash", paymentModes: ["UPI", "Cash"] },
  );
  assert.deepEqual(billModes([{ method: "UPI", amount: 300 }]), {
    paymentMethod: "UPI",
    paymentModes: null,
  });
  // The same mode twice is one mode.
  assert.deepEqual(
    billModes([
      { method: "Cash", amount: 300 },
      { method: "Cash", amount: 100 },
    ]),
    { paymentMethod: "Cash", paymentModes: null },
  );
});

test("bill label", () => {
  assert.equal(billModesLabel({ paymentMethod: "UPI" }), "UPI");
  assert.equal(billModesLabel({ paymentMethod: "Cash", paymentModes: null }), "Cash");
  assert.equal(
    billModesLabel({ paymentMethod: "Cash", paymentModes: ["UPI", "Cash"] }),
    "UPI + Cash",
  );
});
