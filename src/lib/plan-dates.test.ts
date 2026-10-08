import assert from "node:assert/strict";
import { test } from "node:test";
import { packageMonths, planDays, planEndDate } from "./plan-dates.ts";

test("months end the day before the same date, like the old software", () => {
  assert.equal(planEndDate("2026-09-01", 30), "2026-09-30");
  assert.equal(planEndDate("2026-07-24", 30), "2026-08-23");
  assert.equal(planEndDate("2026-08-23", 30), "2026-09-22");
  assert.equal(planEndDate("2026-06-02", 180), "2026-12-01");
  assert.equal(planEndDate("2026-08-31", 365), "2027-08-30");
  assert.equal(planEndDate("2026-08-12", 365), "2027-08-11");
  assert.equal(planEndDate("2025-12-01", 365), "2026-11-30");
  assert.equal(planEndDate("2026-10-21", 60), "2026-12-20");
  assert.equal(planEndDate("2026-01-01", 360), "2026-12-31");
});

test("month ends and leap years", () => {
  assert.equal(planEndDate("2026-01-31", 30), "2026-02-27");
  assert.equal(planEndDate("2028-01-31", 30), "2028-02-28");
  assert.equal(planEndDate("2028-02-29", 365), "2029-02-27");
  assert.equal(planEndDate("2026-12-15", 30), "2027-01-14");
});

test("day passes are exactly that many days", () => {
  assert.equal(planEndDate("2026-10-08", 1), "2026-10-08");
  assert.equal(planEndDate("2026-10-08", 15), "2026-10-22");
  assert.equal(planEndDate("2026-10-08", 7), "2026-10-14");
  assert.equal(planDays("2026-10-08", planEndDate("2026-10-08", 15)), 15);
});

test("package lengths read as months", () => {
  assert.equal(packageMonths(30), 1);
  assert.equal(packageMonths(90), 3);
  assert.equal(packageMonths(365), 12);
  assert.equal(packageMonths(15), 0);
  assert.equal(packageMonths(0), 0);
});

test("bad input is left alone", () => {
  assert.equal(planEndDate("", 30), "");
  assert.equal(planDays("2026-09-01", "2026-09-30"), 30);
});
