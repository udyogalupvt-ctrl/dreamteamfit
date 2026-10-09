import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conflictMessage,
  overlapConflict,
  overlapDays,
  overlapPairs,
  overlapPlan,
  type OverlapPlan,
} from "./plan-overlap.ts";

const T = "2026-10-09";
const plan = (
  id: string,
  startDate: string,
  endDate: string,
  over: Partial<OverlapPlan> = {},
): OverlapPlan => ({
  id,
  clientId: "c1",
  name: `Plan ${id}`,
  startDate,
  endDate,
  status: "active",
  paidInOldSoftware: false,
  endedBy: "",
  upgradedTo: "",
  createdMs: 0,
  updatedMs: 0,
  overlapOk: [],
  ...over,
});

test("overlapDays counts shared days, both ends included", () => {
  assert.equal(
    overlapDays(plan("a", "2026-10-01", "2026-10-31"), plan("b", "2026-10-31", "2026-11-29")),
    1,
  );
  assert.equal(
    overlapDays(plan("a", "2026-10-01", "2026-10-31"), plan("b", "2026-11-01", "2026-11-30")),
    0,
  );
  assert.equal(
    overlapDays(plan("a", "2026-10-01", "2026-10-31"), plan("b", "2026-10-01", "2026-10-31")),
    31,
  );
  assert.equal(
    overlapDays(plan("a", "2026-10-10", "2026-10-12"), plan("b", "2026-10-01", "2026-12-31")),
    3,
  );
});

test("a renewal starting the day after the running plan is fine", () => {
  const running = plan("RUN", "2026-10-01", "2026-10-31");
  assert.equal(
    overlapConflict({ startDate: "2026-11-01", endDate: "2026-11-30" }, [running], T),
    null,
  );
});

test("a sale or old plan over the running plan is refused, naming that plan", () => {
  const running = plan("RUN", "2026-10-01", "2026-10-31", { paidInOldSoftware: true });
  const hit = overlapConflict({ startDate: "2026-10-09", endDate: "2026-11-08" }, [running], T);
  assert.equal(hit?.id, "RUN");
  assert.match(
    conflictMessage(hit!),
    /Plan RUN from 1 Oct 2026 to 31 Oct 2026 \(paid in the old software\)/,
  );
});

test("an old plan added under a later running plan is refused (audit item 14)", () => {
  const later = plan("LATER", "2026-10-05", "2026-11-04");
  assert.equal(
    overlapConflict({ startDate: "2026-09-15", endDate: "2026-10-14" }, [later], T)?.id,
    "LATER",
  );
});

test("the plan being upgraded, cancelled plans and plans a renewal ended do not block", () => {
  const up = plan("UP", "2026-10-01", "2026-10-31");
  const gone = plan("GONE", "2026-10-01", "2026-10-31", { status: "cancelled" });
  const stamped = plan("ST", "2026-09-20", "2026-10-19", { status: "expired", endedBy: "X" });
  const early = plan("EARLY", "2026-09-20", "2026-10-19", { status: "expired" });
  const range = { startDate: "2026-10-09", endDate: "2026-11-08" };
  assert.equal(overlapConflict(range, [up, gone, stamped, early], T, ["UP"]), null);
});

test("a copy of a plan that already ended is refused (both would count their money)", () => {
  const ended = plan("OLD", "2026-08-01", "2026-08-31", {
    status: "expired",
    paidInOldSoftware: true,
  });
  assert.equal(
    overlapConflict({ startDate: "2026-08-01", endDate: "2026-08-31" }, [ended], T)?.id,
    "OLD",
  );
});

test("overlapPairs: two copies of one old plan are listed once", () => {
  const a = plan("A", "2026-10-01", "2026-10-31", { paidInOldSoftware: true });
  const b = plan("B", "2026-10-01", "2026-10-31", { paidInOldSoftware: true });
  const pairs = overlapPairs([b, a]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.a.id, "A");
  assert.equal(pairs[0]!.b.id, "B");
  assert.equal(pairs[0]!.days, 31);
});

test("overlapPairs leaves out renewals, upgrades, cancelled, checked pairs and other members", () => {
  const renewed = plan("R1", "2026-10-01", "2026-10-31", { status: "expired", endedBy: "R2" });
  const renewal = plan("R2", "2026-10-05", "2026-11-04");
  const older = plan("O1", "2026-09-01", "2026-09-30", {
    clientId: "c2",
    status: "expired",
    updatedMs: 500,
  });
  const sale = plan("O2", "2026-09-10", "2026-10-09", { clientId: "c2", createdMs: 500 });
  const up = plan("U1", "2026-10-01", "2026-10-31", { clientId: "c3", upgradedTo: "U2" });
  const upNew = plan("U2", "2026-10-10", "2027-01-09", { clientId: "c3" });
  const gone = plan("G", "2026-10-01", "2026-10-31", { clientId: "c4", status: "cancelled" });
  const keep = plan("K", "2026-10-01", "2026-10-31", { clientId: "c4" });
  const ok1 = plan("OK1", "2026-10-01", "2026-10-31", { clientId: "c5", overlapOk: ["OK2"] });
  const ok2 = plan("OK2", "2026-10-15", "2026-11-14", { clientId: "c5" });
  const other = plan("X", "2026-10-01", "2026-10-31", { clientId: "c6" });
  assert.deepEqual(
    overlapPairs([renewed, renewal, older, sale, up, upNew, gone, keep, ok1, ok2, other]),
    [],
  );
});

test("overlapPairs: most shared days first", () => {
  const pairs = overlapPairs([
    plan("A", "2026-10-01", "2026-10-31"),
    plan("B", "2026-10-30", "2026-11-29"),
    plan("C", "2026-10-01", "2026-10-31", { clientId: "c2" }),
    plan("D", "2026-10-01", "2026-10-31", { clientId: "c2" }),
  ]);
  assert.deepEqual(
    pairs.map((p) => [p.clientId, p.days]),
    [
      ["c2", 31],
      ["c1", 2],
    ],
  );
});

test("overlapPlan reads a plan document (timestamps, stamps, checked list)", () => {
  const p = overlapPlan("m1", {
    clientId: "c1",
    packageNameSnapshot: "Monthly",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    status: "active",
    paidInOldSoftware: true,
    endedBy: "m2",
    createdAt: { toMillis: () => 10 },
    updatedAt: { toDate: () => new Date(20) },
    overlapOk: ["m3"],
  });
  assert.deepEqual(
    [p.name, p.paidInOldSoftware, p.endedBy, p.upgradedTo, p.createdMs, p.updatedMs, p.overlapOk],
    ["Monthly", true, "m2", "", 10, 20, ["m3"]],
  );
});

test("Edit plan: a plan an older-style renewal ended (same write) never blocks the renewal's edit", () => {
  // A ran 1–30 Sep; renewal B (sold 20 Sep, before the endedBy stamp) ended it in its own write.
  const a = plan("A", "2026-09-01", "2026-09-30", { status: "expired", updatedMs: 777 });
  const b = plan("B", "2026-09-20", "2026-10-19", { createdMs: 777 });
  const edited = { ...b, endDate: "2026-10-22" };
  assert.equal(
    overlapConflict(edited, [a, b], T, ["B"], { startDate: b.startDate, endDate: b.endDate }),
    null,
  );
});

test("Edit plan: only days newly shared are refused", () => {
  const a = plan("A", "2026-09-01", "2026-09-30", { status: "expired" });
  const b = plan("B", "2026-09-25", "2026-10-24");
  const before = { startDate: b.startDate, endDate: b.endDate };
  // Moving the end: still 6 shared days → allowed.
  assert.equal(overlapConflict({ ...b, endDate: "2026-10-30" }, [a, b], T, ["B"], before), null);
  // Moving the start earlier: 10 shared days → refused.
  assert.equal(
    overlapConflict({ ...b, startDate: "2026-09-21" }, [a, b], T, ["B"], before)?.id,
    "A",
  );
});

test("pairs marked Not a duplicate are not refused", () => {
  const a = plan("A", "2026-10-01", "2026-10-31", { overlapOk: ["B"] });
  const b = plan("B", "2026-10-15", "2026-11-14", { overlapOk: ["A"] });
  assert.equal(overlapConflict({ ...b, startDate: "2026-10-10" }, [a, b], T, ["B"]), null);
});

test("a backdated upgrade: days the upgraded plan already shared do not block it", () => {
  const a = plan("A", "2026-09-01", "2026-09-30", { status: "expired" });
  const r = plan("R", "2026-09-20", "2026-10-19");
  const sale = { startDate: "2026-09-25", endDate: "2027-09-24" };
  assert.equal(overlapConflict(sale, [a, r], T, ["R"], r), null);
  assert.equal(overlapConflict(sale, [a, r], T, ["R"])?.id, "A");
});
