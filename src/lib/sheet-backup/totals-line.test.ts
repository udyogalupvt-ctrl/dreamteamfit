import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyMoneyColumns,
  inr,
  istStamp,
  monthFromTitle,
  monthOf,
  monthRange,
  monthsBetween,
  monthTitle,
  monthTotalsLine,
  prevMonth,
  totalsRow,
} from "./totals-line.ts";
import { MONTH_COLUMNS, type MonthRow } from "./month.ts";
import { duesTab } from "./tabs.ts";

test("inr groups the Indian way", () => {
  assert.equal(inr(0), "₹0");
  assert.equal(inr(999), "₹999");
  assert.equal(inr(1999), "₹1,999");
  assert.equal(inr(207049), "₹2,07,049");
  assert.equal(inr(159046), "₹1,59,046");
  assert.equal(inr(12345678), "₹1,23,45,678");
  assert.equal(inr(-500), "-₹500");
  assert.equal(inr(1999.5), "₹1,999.50");
});

test("istStamp is Indian time, 12-hour", () => {
  assert.equal(istStamp(new Date("2026-10-13T17:12:00Z")), "13 Oct, 10:42 pm");
  assert.equal(istStamp(new Date("2026-10-13T18:30:00Z")), "14 Oct, 12:00 am");
  assert.equal(istStamp(new Date("2026-01-05T06:30:00Z")), "5 Jan, 12:00 pm");
});

test("month helpers", () => {
  assert.equal(monthTitle("2026-10"), "Oct 2026");
  assert.equal(monthFromTitle("Oct 2026"), "2026-10");
  assert.equal(monthFromTitle("Members"), null);
  assert.equal(monthOf("2026-10-13"), "2026-10");
  assert.equal(monthOf(""), "");
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(prevMonth("2026-10"), "2026-09");
  assert.deepEqual(monthsBetween("2025-11", "2026-02"), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
  assert.deepEqual(monthRange("2026-09", "2026-10-13"), { from: "2026-09-01", to: "2026-09-31" });
  assert.deepEqual(monthRange("2026-10", "2026-10-13"), { from: "2026-10-01", to: "2026-10-13" });
});

test("month totals line says matches or DIFFERENT", () => {
  const p = { count: 42, appTotal: 207049, stamp: "13 Oct, 10:42 pm" };
  assert.equal(
    monthTotalsLine({ ...p, matches: true }),
    "42 payments · app shows ₹2,07,049 ✓ matches · updated 13 Oct, 10:42 pm",
  );
  assert.match(monthTotalsLine({ ...p, matches: false }), /✗ DIFFERENT/);
});

test("totals row: TOTAL in A, the line in NAME, SUM formulas from row 3, DUE as a number", () => {
  const row = totalsRow(MONTH_COLUMNS, "the line", 4500);
  assert.equal(row.length, MONTH_COLUMNS.length);
  assert.equal(row[0], "TOTAL");
  assert.equal(row[2], "the line");
  const at = (h: string) => MONTH_COLUMNS.findIndex((c) => c.header === h);
  assert.equal(row[at("PP")], "=SUM(G3:G)");
  assert.equal(row[at("PAID AMOUNT")], "=SUM(L3:L)");
  assert.equal(row[at("DUE NOW")], 4500);
  assert.equal(row[at("STATUS")], "");
});

test("totals row on a tab whose NAME is column A keeps the line there", () => {
  const dues = duesTab({ openBills: [], clients: new Map(), today: "2026-10-13" });
  const row = totalsRow(dues.columns, "0 open bills");
  assert.equal(row[0], "0 open bills");
  assert.equal(row[dues.columns.findIndex((c) => c.header === "DUE")], "=SUM(G3:G)");
});

test("money columns that are empty all month are marked to hide", () => {
  const rows = [
    { cash: 2000, paid: 2000, pp: 0 },
    { cash: 500, paid: 500, pp: 0 },
  ] as unknown as MonthRow[];
  const hide = emptyMoneyColumns(MONTH_COLUMNS, rows);
  const at = (h: string) => MONTH_COLUMNS.findIndex((c) => c.header === h);
  assert.equal(hide[at("PP")], true);
  assert.equal(hide[at("CASH")], false);
  assert.equal(hide[at("PAID AMOUNT")], false);
  assert.equal(hide[at("NAME")], false);
});
