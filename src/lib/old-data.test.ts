import assert from "node:assert/strict";
import { test } from "node:test";
import {
  oldPersonFor,
  oldPlanCovering,
  oldPlanInRecords,
  type OldMember,
  type OldPlan,
} from "./old-data.ts";

const plan = (o: Partial<OldPlan>): OldPlan => ({
  name: "Monthly",
  price: 2000,
  discount: 0,
  amount: 2000,
  balance: 0,
  start: "2026-09-01",
  end: "2026-09-30",
  nextPayment: "",
  status: "Active",
  counsellor: "",
  createdBy: "",
  bill: "",
  remark: "",
  ...o,
});
const person = (plans: OldPlan[], memberId = "101", name = "P Joshi") => ({
  memberId,
  name,
  plans,
});

test("a plan the old software has for these days is found (any overlap, nearest start first)", () => {
  const sep = plan({ start: "2026-09-01", end: "2026-09-30" });
  const late = plan({ start: "2026-09-28", end: "2026-10-27" });
  const p = person([sep, late]);
  assert.equal(oldPlanCovering(p, { kind: "gym", start: "2026-10-01", end: "2026-10-31" }), late);
  assert.equal(oldPlanCovering(p, { kind: "gym", start: "2026-09-05", end: "2026-10-04" }), sep);
});

test("an October plan the old software never had: nothing (the October check's case)", () => {
  const p = person([plan({ start: "2026-08-01", end: "2026-08-31" }), plan({})]);
  assert.equal(oldPlanCovering(p, { kind: "gym", start: "2026-10-09", end: "2026-11-08" }), null);
  assert.equal(
    oldPlanCovering(null, { kind: "gym", start: "2026-10-09", end: "2026-11-08" }),
    null,
  );
});

test("the same kind first, but any old plan for those days counts (gym + PT plans there)", () => {
  const pt = plan({ name: "PT 1 month", start: "2026-09-20", end: "2026-10-19" });
  const gym = plan({ name: "Quarterly", start: "2026-08-15", end: "2026-11-14" });
  const p = person([pt, gym]);
  assert.equal(oldPlanCovering(p, { kind: "gym", start: "2026-09-20", end: "2026-10-19" }), gym);
  assert.equal(oldPlanCovering(p, { kind: "pt", start: "2026-09-20", end: "2026-10-19" }), pt);
  assert.equal(
    oldPlanCovering(person([gym]), { kind: "pt", start: "2026-09-20", end: "2026-10-19" }),
    gym,
  );
});

test("a plan with no end there counts from its start on", () => {
  const open = plan({ start: "2026-10-02", end: "" });
  assert.equal(
    oldPlanCovering(person([open]), { kind: "gym", start: "2026-10-01", end: "2026-10-31" }),
    open,
  );
  const annual = plan({ name: "Annual", start: "2026-03-01", end: "" });
  assert.equal(
    oldPlanCovering(person([annual]), { kind: "gym", start: "2026-10-01", end: "2027-02-28" }),
    annual,
  );
  assert.equal(
    oldPlanCovering(person([annual]), { kind: "gym", start: "2026-01-01", end: "2026-02-27" }),
    null,
  );
  assert.equal(
    oldPlanCovering(person([plan({ start: "", end: "" })]), {
      kind: "gym",
      start: "2026-10-01",
      end: "2026-10-31",
    }),
    null,
  );
});

test("whose record: the linked old member ID, else the name, else the only one", () => {
  const a = person([], "7", "K Mothilal");
  const b = person([], "8", "K Sri Devi");
  assert.equal(oldPersonFor([a, b], { oldMemberId: "8", name: "Someone" }), b);
  assert.equal(oldPersonFor([a, b], { oldMemberId: "", name: "Sri Devi K" }), b);
  assert.equal(oldPersonFor([a], { oldMemberId: "", name: "Other" }), a);
  assert.equal(oldPersonFor([a, b], { oldMemberId: "", name: "Ravi" }), null);
  assert.equal(oldPersonFor([], { oldMemberId: "7", name: "K Mothilal" }), null);
});

test("a family's phone: the name fits no record clearly → any record on the phone counts", () => {
  const rec = (memberId: string, name: string, plans: OldPlan[]) =>
    ({ ...person(plans, memberId, name) }) as unknown as OldMember;
  const sep = plan({ start: "2026-09-01", end: "2026-09-30" });
  const records = [rec("1", "Ravikumar", [sep]), rec("2", "Teja R", [])];
  const days = { kind: "gym" as const, start: "2026-09-10", end: "2026-10-09" };
  assert.equal(oldPlanInRecords(records, { oldMemberId: "", name: "Ravi Kumar" }, days), sep);
  // Their own record found: only theirs counts.
  assert.equal(oldPlanInRecords(records, { oldMemberId: "2", name: "Teja R" }, days), null);
});
