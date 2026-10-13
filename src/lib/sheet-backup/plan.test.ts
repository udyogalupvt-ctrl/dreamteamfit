import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeQueue, stepsFor, tabOrder } from "./plan.ts";

const base = { today: "2026-10-13", collections: ["clients", "payments"] };

test("quick: touched months, Members, Dues, touched restore rows, Read me last", () => {
  const steps = stepsFor({
    ...base,
    mode: "quick",
    months: ["2026-09", "2026-10"],
    touchedCollections: ["payments", "expenses"],
  });
  assert.deepEqual(steps, [
    "month:2026-10",
    "month:2026-09",
    "members",
    "dues",
    "expenses",
    "touch:payments",
    "readme",
  ]);
});

test("quick: plan edits also refresh All plans; unknown collections are not backed up", () => {
  const steps = stepsFor({
    ...base,
    mode: "quick",
    months: ["2026-10"],
    touchedCollections: ["memberships", "waChats"],
  });
  assert.ok(steps.includes("plans"));
  assert.ok(!steps.some((s) => s.includes("waChats")));
});

test("nightly: this and last month, every readable tab, every restore tab, Read me last", () => {
  const steps = stepsFor({ ...base, mode: "nightly" });
  assert.deepEqual(steps, [
    "month:2026-10",
    "month:2026-09",
    "members",
    "dues",
    "expenses",
    "plans",
    "staff",
    "packages",
    "data:clients",
    "data:payments",
    "readme",
  ]);
});

test("full: every month from the first payment, newest first", () => {
  const steps = stepsFor({ ...base, mode: "full", earliestMonth: "2026-07" });
  assert.deepEqual(
    steps.filter((s) => s.startsWith("month:")),
    ["month:2026-10", "month:2026-09", "month:2026-08", "month:2026-07"],
  );
  assert.equal(steps.at(-1), "readme");
});

test("full with no payments yet still does this and last month", () => {
  const steps = stepsFor({ ...base, mode: "full", earliestMonth: null });
  assert.deepEqual(
    steps.filter((s) => s.startsWith("month:")),
    ["month:2026-10", "month:2026-09"],
  );
});

test("merging keeps the old order, drops repeats, keeps Read me last", () => {
  const merged = mergeQueue(
    ["members", "readme", "data:clients"],
    ["month:2026-10", "members", "readme"],
  );
  assert.deepEqual(merged, ["members", "data:clients", "month:2026-10", "readme"]);
});

test("a full copy of a collection makes its touch step redundant", () => {
  assert.deepEqual(mergeQueue(["touch:payments"], ["data:payments", "readme"]), [
    "data:payments",
    "readme",
  ]);
});

test("tab order: Read me, Members, Dues, months newest first, the rest, hidden last", () => {
  assert.deepEqual(
    tabOrder([
      "_data_payments",
      "Packages",
      "Sep 2026",
      "Dues",
      "Notes",
      "Oct 2026",
      "Read me",
      "Aug 2025",
      "Expenses",
      "Members",
      "_data_clients",
      "Staff & trainers",
      "All plans",
    ]),
    [
      "Read me",
      "Members",
      "Dues",
      "Oct 2026",
      "Sep 2026",
      "Aug 2025",
      "Expenses",
      "All plans",
      "Staff & trainers",
      "Packages",
      "Notes",
      "_data_clients",
      "_data_payments",
    ],
  );
});
