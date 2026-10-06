import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCount,
  formatDay,
  formatMonths,
  formatPercent,
  formatRupees,
  formatSignedCount,
  roundRupee,
} from "./money.ts";

test("formatRupees uses Indian grouping, whole rupees and a leading minus", () => {
  assert.equal(formatRupees(190000), "₹1,90,000");
  assert.equal(formatRupees(0), "₹0");
  assert.equal(formatRupees(-5000), "-₹5,000");
  assert.equal(formatRupees(1234567), "₹12,34,567");
  assert.equal(formatRupees(1999.6), "₹2,000");
  assert.equal(formatRupees(-0.2), "₹0"); // no "-₹0"
});

test("formatPercent", () => {
  assert.equal(formatPercent(0.7), "70%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(1), "100%");
  assert.equal(formatPercent(2 / 3), "67%");
  assert.equal(formatPercent(null), "not enough data");
});

test("formatMonths", () => {
  assert.equal(formatMonths(2.43), "2.4 months");
  assert.equal(formatMonths(1), "1.0 months");
  assert.equal(formatMonths(0), "0.0 months");
  assert.equal(formatMonths(null), "not enough data");
});

test("formatCount and formatSignedCount", () => {
  assert.equal(formatCount(1234), "1,234");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(null), "not enough data");
  assert.equal(formatSignedCount(5), "+5");
  assert.equal(formatSignedCount(-3), "-3");
  assert.equal(formatSignedCount(0), "0");
});

test("formatDay", () => {
  assert.equal(formatDay("2026-10-06"), "6 Oct 2026");
  assert.equal(formatDay("2027-01-31"), "31 Jan 2027");
  assert.equal(formatDay("bad"), "bad");
});

test("roundRupee turns bad numbers into 0 and never returns -0", () => {
  assert.equal(roundRupee(2.5), 3);
  assert.equal(roundRupee(-2.5), -2);
  assert.equal(Object.is(roundRupee(-0.2), 0), true);
  assert.equal(roundRupee(Number.NaN), 0);
  assert.equal(roundRupee(Infinity), 0);
});
