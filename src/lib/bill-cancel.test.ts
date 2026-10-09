import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billOwed,
  billStatus,
  cancelBills,
  cancelledDueOf,
  keptAllocationBill,
  restorePart,
  shareDue,
  takeBackBlocked,
  type CancelBill,
} from "./bill-cancel.ts";

// The audit example: Gym ₹2,500 + PT ₹12,000 on one bill, ₹5,000 paid, ₹9,500 due.
const combo = (over: Partial<CancelBill> = {}): CancelBill => ({
  id: "b1",
  invoiceNumber: "B-1",
  membershipId: "g1",
  ptAssignmentId: "p1",
  subtotal: 14500,
  discount: 0,
  total: 14500,
  amountPaid: 5000,
  balanceDue: 9500,
  paymentStatus: "partial",
  membershipGross: 2500,
  ptGross: 12000,
  trainerShareTotal: 6000,
  ...over,
});
const price = { g1: 2500, p1: 12000 } as Record<string, number>;

test("shareDue: the cancelled plan's unpaid part, by price", () => {
  assert.equal(shareDue(combo(), "pt", 12000), 7862);
  assert.equal(shareDue(combo(), "gym", 2500), 1638);
  // An old bill without the gym / PT split uses the plan's price.
  assert.equal(shareDue(combo({ membershipGross: 0, ptGross: 0 }), "pt", 12000), 7862);
  assert.equal(shareDue(combo({ balanceDue: 0, amountPaid: 14500 }), "pt", 12000), 0);
});

test("cancelBills: PT cancelled alone on a gym + PT bill lowers it", () => {
  const r = cancelBills([combo()], new Set(["p1"]), price);
  assert.deepEqual(r.close, []);
  assert.equal(r.lower.length, 1);
  assert.equal(r.lower[0]!.kind, "pt");
  assert.equal(r.lower[0]!.amount, 7862);
  assert.equal(r.lower[0]!.left, 1638);
});

test("cancelBills: both plans, or a bill of only this plan, is closed", () => {
  assert.equal(cancelBills([combo()], new Set(["g1", "p1"]), price).close.length, 1);
  const ptOnly = combo({ membershipId: null, membershipGross: 0, subtotal: 12000, total: 12000 });
  assert.equal(cancelBills([ptOnly], new Set(["p1"]), price).close.length, 1);
  // The PT was cancelled before (part dropped): cancelling the gym plan closes the rest.
  const after = combo({
    balanceDue: 1638,
    cancelledDue: 7862,
    cancelledParts: { c1: { kind: "pt", amount: 7862 } },
  });
  const r = cancelBills([after], new Set(["g1"]), price);
  assert.equal(r.close.length, 1);
  assert.equal(r.lower.length, 0);
});

test("cancelBills: skips bills with nothing due, refunded, closed or not of these plans", () => {
  const set = new Set(["p1"]);
  assert.equal(cancelBills([combo({ balanceDue: 0 })], set, price).lower.length, 0);
  assert.equal(cancelBills([combo({ paymentStatus: "refunded" })], set, price).lower.length, 0);
  assert.equal(cancelBills([combo({ paymentStatus: "closed" })], set, price).lower.length, 0);
  assert.equal(cancelBills([combo()], new Set(["x"]), price).lower.length, 0);
  // A bill of other items only (no plan) is never touched.
  const shop = combo({ membershipId: null, ptAssignmentId: null });
  assert.equal(cancelBills([shop], set, price).close.length, 0);
});

test("billOwed / billStatus count the dropped part", () => {
  assert.equal(billOwed(14500, 5000, 7862), 1638);
  assert.equal(billOwed(14500, 6638, 7862), 0);
  assert.equal(billStatus(14500, 5000, 7862), "partial");
  assert.equal(billStatus(14500, 6638, 7862), "paid");
  assert.equal(billStatus(14500, 0, 14500), "closed");
  assert.equal(billStatus(14500, 0, 7862), "pending");
  // Nothing dropped: as before.
  assert.equal(billStatus(14500, 14500, 0), "paid");
  assert.equal(billStatus(14500, 0, 0), "pending");
});

test("cancelledDueOf adds the parts (or reads the stored sum)", () => {
  assert.equal(cancelledDueOf(combo()), 0);
  assert.equal(cancelledDueOf({ cancelledDue: 100 }), 100);
  assert.equal(
    cancelledDueOf({
      cancelledParts: { a: { kind: "pt", amount: 7862 }, b: { kind: "gym", amount: 1 } },
    }),
    7863,
  );
});

test("keptAllocationBill: later payments go to the plan still running", () => {
  const ptGone = keptAllocationBill(
    combo({ cancelledParts: { c1: { kind: "pt", amount: 7862 } } }),
  );
  assert.equal(ptGone.ptGross, 0);
  assert.equal(ptGone.trainerShareTotal, 0);
  assert.equal(ptGone.membershipGross, 2500);
  assert.equal(ptGone.subtotal, 2500);
  assert.equal(ptGone.total, 2500);
  const gymGone = keptAllocationBill(
    combo({ discount: 1450, total: 13050, cancelledParts: { c1: { kind: "gym", amount: 1 } } }),
  );
  assert.equal(gymGone.membershipGross, 0);
  assert.equal(gymGone.ptGross, 12000);
  assert.equal(gymGone.trainerShareTotal, 6000);
  assert.equal(gymGone.subtotal, 12000);
  assert.equal(gymGone.discount, 1200);
  assert.equal(gymGone.total, 10800);
  // Nothing cancelled: the bill as it is.
  assert.equal(keptAllocationBill(combo()).ptGross, 12000);
});

test("restorePart: Undo asks for the dropped part again", () => {
  const b = combo({
    balanceDue: 1638,
    cancelledDue: 7862,
    cancelledParts: { c1: { kind: "pt", amount: 7862 } },
  });
  assert.deepEqual(restorePart(b, "c1"), {
    cancelledDue: 0,
    cancelledParts: null,
    balanceDue: 9500,
    paymentStatus: "partial",
  });
  // The member paid the gym part in between: still the PT part is asked again.
  const paidLater = { ...b, amountPaid: 6638, balanceDue: 0, paymentStatus: "paid" };
  assert.deepEqual(restorePart(paidLater, "c1"), {
    cancelledDue: 0,
    cancelledParts: null,
    balanceDue: 7862,
    paymentStatus: "partial",
  });
  // Another cancel closed the rest since: that cancel's Undo will ask for this part too.
  const closed = {
    ...b,
    balanceDue: 0,
    paymentStatus: "closed",
    beforeCancel: { balanceDue: 1638, paymentStatus: "partial" },
  };
  assert.deepEqual(restorePart(closed, "c1"), {
    cancelledDue: 0,
    cancelledParts: null,
    closedAmount: 7862,
    beforeCancel: { balanceDue: 9500, paymentStatus: "partial" },
  });
  assert.equal(restorePart(b, "other"), null);
});

test("restorePart: refused when money was collected after the cancel", () => {
  const b = combo({
    amountPaid: 6638,
    balanceDue: 0,
    paymentStatus: "paid",
    cancelledDue: 7862,
    cancelledParts: { c1: { kind: "pt", amount: 7862, paidThen: 5000 } },
  });
  const r = restorePart(b, "c1");
  assert.ok(r && "error" in r && /Remove that payment first/.test(r.error), JSON.stringify(r));
  // That payment removed: back to what was paid then, Restore works.
  const ok = restorePart({ ...b, amountPaid: 5000 }, "c1");
  assert.ok(ok && !("error" in ok) && "balanceDue" in ok && ok.balanceDue === 9500);
});

test("takeBackBlocked: only money collected after the cancel can be taken back", () => {
  const b = {
    invoiceNumber: "B-1",
    amountPaid: 6638,
    cancelledParts: { c1: { kind: "pt" as const, amount: 7862, paidThen: 5000 } },
  };
  assert.equal(takeBackBlocked(b, 1638), "");
  assert.match(takeBackBlocked(b, 2000), /Restore that plan first/);
  assert.match(takeBackBlocked({ ...b, amountPaid: 5000 }, 3000), /Restore that plan first/);
  assert.equal(takeBackBlocked({ ...b, cancelledParts: null }, 3000), "");
});
