import assert from "node:assert/strict";
import { test } from "node:test";
import { planRemove, type RemoveBill, type RemovePayment } from "./payment-remove.ts";

const OPEN = "2026-09-01";

const pay = (o: Partial<RemovePayment> = {}): RemovePayment => ({
  amount: 5000,
  paymentDate: "2026-10-09",
  kind: "balance",
  oldSoftware: false,
  invoiceId: "B1",
  trainerShareAmount: 0,
  cancelId: "",
  ...o,
});
const bill = (o: Partial<RemoveBill> = {}): RemoveBill => ({
  invoiceNumber: "RF-2026-000081",
  total: 5000,
  amountPaid: 5000,
  balanceDue: 0,
  paymentStatus: "paid",
  closedAmount: 0,
  cancelId: "",
  beforeCancel: null,
  ...o,
});
const running = [{ status: "active", cancelId: "" }];
const cancelled = [{ status: "cancelled", cancelId: "c1" }];

test("balance payment on a running plan: the bill asks for it again", () => {
  const r = planRemove(pay(), bill(), running, OPEN);
  assert.equal(r.error, "");
  assert.deepEqual(r.bill?.after, {
    amountPaid: 0,
    balanceDue: 5000,
    paymentStatus: "pending",
    closedAmount: null,
    cancelId: null,
    beforeCancel: null,
  });
  assert.deepEqual(r.bill?.before.amountPaid, 5000);
});

test("part of a bill: partial again", () => {
  const r = planRemove(
    pay({ amount: 2000 }),
    bill({ total: 6000, amountPaid: 6000 }),
    running,
    OPEN,
  );
  assert.equal(r.bill?.after.paymentStatus, "partial");
  assert.equal(r.bill?.after.balanceDue, 2000);
});

test("payment on a cancelled plan's bill: the bill stays Closed; Restore would ask for it again", () => {
  const r = planRemove(pay(), bill(), cancelled, OPEN);
  assert.deepEqual(r.bill?.after, {
    amountPaid: 0,
    balanceDue: 0,
    paymentStatus: "closed",
    closedAmount: 5000,
    cancelId: "c1",
    beforeCancel: { balanceDue: 5000, paymentStatus: "pending" },
  });
});

test("a bill already closed by the cancellation: what Restore asks for grows by the payment", () => {
  const r = planRemove(
    pay({ amount: 3000 }),
    bill({
      total: 10000,
      amountPaid: 7000,
      balanceDue: 0,
      paymentStatus: "closed",
      closedAmount: 3000,
      cancelId: "c1",
      beforeCancel: { balanceDue: 3000, paymentStatus: "partial" },
    }),
    cancelled,
    OPEN,
  );
  assert.deepEqual(r.bill?.after, {
    amountPaid: 4000,
    balanceDue: 0,
    paymentStatus: "closed",
    closedAmount: 6000,
    cancelId: "c1",
    beforeCancel: { balanceDue: 6000, paymentStatus: "partial" },
  });
});

test("old-software money: only when its plan is cancelled (else Edit plan), no bill change", () => {
  assert.match(
    planRemove(pay({ oldSoftware: true, invoiceId: "" }), null, running, OPEN).error,
    /Edit plan/,
  );
  assert.deepEqual(planRemove(pay({ oldSoftware: true, invoiceId: "" }), null, cancelled, OPEN), {
    error: "",
    bill: null,
  });
  // A plan no longer here counts as cancelled only when the caller says so (no plans = refused).
  assert.match(
    planRemove(pay({ oldSoftware: true, invoiceId: "" }), null, [], OPEN).error,
    /Edit plan/,
  );
});

test("a cancellation's refund can go and its bill never changed", () => {
  const refund = pay({ amount: -5000, kind: "refund", cancelId: "c1" });
  assert.deepEqual(planRemove(refund, bill(), cancelled, OPEN), { error: "", bill: null });
  assert.match(
    planRemove({ ...refund, trainerShareAmount: -1000 }, bill(), cancelled, OPEN).error,
    /Restore/,
  );
});

test("a price-change refund can be taken off: the bill shows that money as paid again", () => {
  // ₹1,799 was taken, the price was corrected to ₹1,750 and ₹49 came back by mistake.
  const refund = pay({ amount: -49, kind: "refund", cancelId: "" });
  const b = bill({ total: 1750, amountPaid: 1701, balanceDue: 49, paymentStatus: "partial" });
  const r = planRemove(refund, b, running, OPEN);
  assert.equal(r.error, "");
  assert.equal(r.bill?.after.amountPaid, 1750);
  assert.equal(r.bill?.after.balanceDue, 0);
  assert.equal(r.bill?.after.paymentStatus, "paid");
});

test("a price-change refund that would overpay the bill says to fix the payment first", () => {
  // The real stuck case: ₹1,799 paid, ₹299 given back, bill now ₹1,750.
  const refund = pay({ amount: -299, kind: "refund", cancelId: "" });
  const b = bill({ total: 1750, amountPaid: 1500, balanceDue: 250, paymentStatus: "partial" });
  const r = planRemove(refund, b, running, OPEN);
  assert.match(r.error, /set the payment to ₹1,750 with Edit payment/);
  assert.equal(r.bill, null);
});

test("money given back that is not a refund entry still points at Edit bill / Edit plan", () => {
  assert.match(
    planRemove(pay({ amount: -500, kind: "balance" }), bill(), running, OPEN).error,
    /Edit bill or Edit plan/,
  );
});

test("refused: joining payment with a trainer's share, refunded bill, no bill, more than the bill shows", () => {
  assert.match(
    planRemove(pay({ kind: "initial", trainerShareAmount: 2500 }), bill(), running, OPEN).error,
    /trainer/,
  );
  assert.match(
    planRemove(pay(), bill({ paymentStatus: "refunded" }), running, OPEN).error,
    /refunded/,
  );
  assert.match(planRemove(pay(), null, running, OPEN).error, /bill was not found/);
  assert.match(planRemove(pay({ amount: 6000 }), bill(), running, OPEN).error, /less paid/);
  // A balance payment's trainer share has no payout of its own: it can go.
  assert.equal(planRemove(pay({ trainerShareAmount: 1000 }), bill(), running, OPEN).error, "");
});

test("a payment dated in a closed Day Book month can't go (old-software money can: never in the drawer)", () => {
  assert.match(
    planRemove(pay({ paymentDate: "2026-07-15" }), bill(), running, OPEN).error,
    /dated 15 Jul 2026, in a closed Day Book month \(before 1 Sep 2026\)/,
  );
  assert.equal(
    planRemove(
      pay({ oldSoftware: true, invoiceId: "", paymentDate: "2026-07-15" }),
      null,
      cancelled,
      OPEN,
    ).error,
    "",
  );
});

test("plans no longer here: old-software money can go; a bill is not closed for good by them alone", () => {
  const missing = [{ status: "missing", cancelId: "" }];
  assert.equal(
    planRemove(pay({ oldSoftware: true, invoiceId: "" }), null, missing, OPEN).error,
    "",
  );
  const r = planRemove(pay(), bill(), missing, OPEN);
  assert.equal(r.bill?.after.paymentStatus, "pending");
  assert.equal(r.bill?.after.balanceDue, 5000);
});

test("one part of a Cash + UPI payment: make it one payment first (Edit payment)", () => {
  const r = planRemove(pay({ splitId: "u1" }), bill(), running, OPEN);
  assert.match(r.error, /Cash \+ UPI/);
  assert.equal(r.bill, null);
});
