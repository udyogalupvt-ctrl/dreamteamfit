import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  fromDay,
  monthKey,
  monthLabel,
  monthStart,
  reportWindow,
  toDay,
} from "./dates.ts";

test("toDay / fromDay round-trip and reject bad dates", () => {
  assert.equal(fromDay(toDay("2026-10-06")!), "2026-10-06");
  assert.equal(toDay(""), null);
  assert.equal(toDay("2026-13-01"), null);
  assert.equal(toDay("2026-02-30"), null);
  assert.equal(toDay("garbage"), null);
  assert.equal(toDay(null), null);
});

test("addDays and diffDays cross month and year ends", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-10-01", "2026-10-06"), 5);
  assert.equal(diffDays("2026-10-06", "2026-10-01"), -5);
});

test("daysInMonth handles February in leap and normal years", () => {
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2028-02"), 29);
  assert.equal(daysInMonth("2026-10"), 31);
  assert.equal(daysInMonth("2026-09"), 30);
});

test("month helpers", () => {
  assert.equal(monthKey("2026-10-06"), "2026-10");
  assert.equal(monthStart("2026-10"), "2026-10-01");
  assert.equal(addMonths("2026-10", -6), "2026-04");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(monthLabel("2026-09"), "Sep 2026");
});

test("reportWindow: 6 full months then this month up to today", () => {
  const w = reportWindow("2026-10-06");
  assert.equal(w.today, "2026-10-06");
  assert.equal(w.windowStart, "2026-04-01");
  assert.equal(w.lastMonthStart, "2026-09-01");
  assert.equal(w.months.length, 7);
  assert.deepEqual(w.months[0], { key: "2026-04", from: "2026-04-01", to: "2026-04-30" });
  assert.deepEqual(w.months[5], { key: "2026-09", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(w.months[6], { key: "2026-10", from: "2026-10-01", to: "2026-10-06" });
});

test("reportWindow across a year end and on the 1st of the month", () => {
  const w = reportWindow("2027-01-01");
  assert.equal(w.windowStart, "2026-07-01");
  assert.equal(w.lastMonthStart, "2026-12-01");
  assert.deepEqual(w.months[6], { key: "2027-01", from: "2027-01-01", to: "2027-01-01" });
});
