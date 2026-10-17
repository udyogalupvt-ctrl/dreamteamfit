import assert from "node:assert/strict";
import { test } from "node:test";
import { closedMoney, putBackProblem } from "./closed-month.ts";

const pay = (paymentDate: string, amount = 100, oldSoftware = false) => ({
  paymentDate,
  amount,
  oldSoftware,
});

test("money dated from the 1st of last month on is open", () => {
  assert.deepEqual(closedMoney([pay("2026-09-01"), pay("2026-09-30"), pay("2026-10-02")], "2026-09-01"), []);
});

test("money dated before the 1st of last month is closed", () => {
  const out = closedMoney([pay("2026-08-31"), pay("2026-10-02"), pay("2025-12-01", -500)], "2026-09-01");
  assert.deepEqual(
    out.map((p) => p.paymentDate),
    ["2026-08-31", "2025-12-01"],
  );
});

test("old-software money never was drawer cash: never closed", () => {
  assert.deepEqual(closedMoney([pay("2025-01-05", 900, true)], "2026-09-01"), []);
});

test("a payment without a date is not treated as closed", () => {
  assert.deepEqual(closedMoney([pay("")], "2026-09-01"), []);
});

test("putBackProblem: closed months never; refunds only by Finance", () => {
  const open = "2026-09-01";
  assert.equal(putBackProblem([pay("2026-09-10"), pay("2026-10-01")], open, false), "");
  assert.match(putBackProblem([pay("2026-08-31")], open, true), /closed Day Book month/);
  assert.match(putBackProblem([pay("2026-10-01", -500)], open, false), /Only Finance/);
  assert.equal(putBackProblem([pay("2026-10-01", -500)], open, true), "");
  assert.equal(putBackProblem([pay("2025-02-01", 900, true)], open, false), "");
  assert.equal(putBackProblem([], open, false), "");
});
