import assert from "node:assert/strict";
import { test } from "node:test";
import { currentRow, pickCurrent, sameCurrent, type CurrentRow } from "./current-plan.ts";

const T = "2026-10-09";
const row = (id: string, startDate: string, endDate: string, status = "active"): CurrentRow => ({
  id,
  name: `Plan ${id}`,
  startDate,
  endDate,
  status,
});

test("running today beats a later queued renewal", () => {
  const r = pickCurrent(
    [row("R", "2026-11-01", "2026-11-30", "pending"), row("A", "2026-10-01", "2026-10-31")],
    T,
  );
  assert.equal(r.summary?.membershipId, "A");
  assert.equal(r.summary?.status, "active");
  assert.equal(r.active, true);
});

test("two running plans: the latest start wins, whatever order they come in", () => {
  const a = row("A", "2026-09-15", "2026-10-14");
  const b = row("B", "2026-10-01", "2026-10-31");
  assert.equal(pickCurrent([a, b], T).summary?.membershipId, "B");
  assert.equal(pickCurrent([b, a], T).summary?.membershipId, "B");
});

test("same start: the same plan every time (by id)", () => {
  const a = row("b2", "2026-10-01", "2026-10-31");
  const b = row("a1", "2026-10-01", "2026-12-31");
  assert.equal(pickCurrent([a, b], T).summary?.membershipId, "a1");
  assert.equal(pickCurrent([b, a], T).summary?.membershipId, "a1");
});

test("a plan ended early by a renewal is not running, even though its dates cover today", () => {
  const cut = row("OLD", "2026-10-01", "2026-10-31", "expired");
  const next = row("NEW", "2026-10-05", "2026-11-04");
  assert.equal(pickCurrent([cut, next], T).summary?.membershipId, "NEW");
});

test("status not rolled yet: dates decide (active plan ended yesterday is not running)", () => {
  const ended = row("E", "2026-09-08", "2026-10-08", "active");
  const soon = row("S", "2026-10-20", "2026-11-19", "pending");
  const r = pickCurrent([ended, soon], T);
  assert.equal(r.summary?.membershipId, "S");
  assert.equal(r.summary?.status, "pending");
  assert.equal(r.active, false);
});

test("waiting for the thumb, started: running", () => {
  assert.equal(
    pickCurrent([row("W", "2026-10-01", "2026-10-31", "biometric_pending")], T).active,
    true,
  );
});

test("nothing running or upcoming: the plan that ended last", () => {
  const r = pickCurrent(
    [
      row("A", "2026-06-01", "2026-06-30", "expired"),
      row("B", "2026-08-01", "2026-08-31", "expired"),
    ],
    T,
  );
  assert.equal(r.summary?.membershipId, "B");
  assert.equal(r.summary?.status, "expired");
});

test("an old plan whose dates are all past never becomes current over a running plan", () => {
  const running = row("RUN", "2026-10-01", "2026-10-31");
  const oldPast = row("OLD", "2026-07-01", "2026-09-30", "expired");
  assert.equal(pickCurrent([oldPast, running], T).summary?.membershipId, "RUN");
});

test("cancelled plans only when nothing else", () => {
  const gone = row("C", "2026-10-01", "2026-10-31", "cancelled");
  assert.equal(
    pickCurrent([gone, row("E", "2026-01-01", "2026-01-31", "expired")], T).summary?.membershipId,
    "E",
  );
  assert.equal(pickCurrent([gone], T).summary?.status, "cancelled");
  assert.equal(pickCurrent([], T).summary, null);
});

test("currentRow reads a plan document", () => {
  assert.deepEqual(
    currentRow("m1", {
      packageNameSnapshot: "Monthly",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      status: "active",
    }),
    { id: "m1", name: "Monthly", startDate: "2026-10-01", endDate: "2026-10-31", status: "active" },
  );
});

test("sameCurrent: only an exact match needs no write", () => {
  const next = pickCurrent([row("A", "2026-10-01", "2026-10-31")], T).summary;
  assert.equal(sameCurrent({ ...next! }, next), true);
  assert.equal(sameCurrent({ ...next!, endDate: "2026-11-30" }, next), false);
  assert.equal(sameCurrent({ status: "expired" }, next), false);
  assert.equal(sameCurrent(null, next), false);
  assert.equal(sameCurrent(null, null), true);
  assert.equal(sameCurrent({ membershipId: "A" }, null), false);
});
