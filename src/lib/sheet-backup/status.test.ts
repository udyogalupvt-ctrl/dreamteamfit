import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStatus, formatWhen, needsAttention, type SheetBackupStatus } from "./status.ts";

const NOW = Date.parse("2026-10-13T17:00:00Z");
const base = (over: Partial<SheetBackupStatus> = {}): SheetBackupStatus => ({
  sheetUrl: "https://docs.google.com/spreadsheets/d/x/edit",
  lastOkAt: "2026-10-13T17:12:00.000Z",
  lastRunAt: "2026-10-13T17:12:00.000Z",
  lastError: null,
  checks: [{ name: "Totals match", ok: true, detail: "" }],
  pending: 0,
  shareWith: "a@b.c",
  ...over,
});

test("time is shown in Indian time, 12-hour", () => {
  assert.equal(formatWhen("2026-10-13T17:12:00.000Z"), "13 Oct, 10:42 pm");
  assert.equal(formatWhen("2026-10-13T18:30:00.000Z"), "14 Oct, 12:00 am");
  assert.equal(formatWhen("2026-10-13T06:30:00.000Z"), "13 Oct, 12:00 pm");
  assert.equal(formatWhen("nope"), "");
});

test("fresh and all checks ok: green", () => {
  const d = describeStatus(base(), NOW + 3_600_000);
  assert.equal(d.kind, "ok");
  assert.equal(d.text, "Up to date · matches the app · last updated 13 Oct, 10:42 pm");
  assert.equal(needsAttention(base(), NOW + 3_600_000), false);
});

test("steps left: amber", () => {
  assert.deepEqual(describeStatus(base({ pending: 3 }), NOW), {
    kind: "updating",
    text: "Updating… 3 steps left",
  });
  assert.equal(describeStatus(base({ pending: 1 }), NOW).text, "Updating… 1 step left");
});

test("a failed check is red, names the check, and needs attention", () => {
  const s = base({
    checks: [{ name: "Totals match", ok: false, detail: "Sheet 1,000 vs app 1,500" }],
  });
  const d = describeStatus(s, NOW);
  assert.equal(d.kind, "problem");
  assert.deepEqual(d.kind === "problem" && d.items, ["Totals match: Sheet 1,000 vs app 1,500"]);
  assert.equal(needsAttention(s, NOW), true);
});

test("last run failed after the last good one: red with the error", () => {
  const s = base({ lastError: "Google said 403", lastRunAt: "2026-10-13T17:30:00.000Z" });
  const d = describeStatus(s, NOW);
  assert.equal(d.kind, "problem");
  assert.deepEqual(d.kind === "problem" && d.items, ["Google said 403"]);
  assert.equal(needsAttention(s, NOW), true);
});

test("never filled and older than 26 hours both need attention", () => {
  const never = base({ lastOkAt: null, lastRunAt: null });
  assert.equal(needsAttention(never, NOW), true);
  assert.equal(describeStatus(never, NOW).kind, "problem");
  const old = base({ lastOkAt: "2026-10-12T14:00:00Z" });
  assert.equal(needsAttention(old, NOW), true);
  assert.equal(describeStatus(old, NOW).kind, "problem");
  assert.equal(needsAttention(base({ lastOkAt: "2026-10-12T16:00:00Z" }), NOW), false, "25 h ok");
});
