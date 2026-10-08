import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkOldRows,
  defaultOldRows,
  diffOldRows,
  oldMoneySplit,
  oldPartnerOf,
  planOldBackfill,
  type OldPlanFact,
} from "./old-money.ts";

const parts = (s: ReturnType<typeof oldMoneySplit>) =>
  Math.round(
    (s.trainerShareAmount + s.membershipGymAmount + s.ptGymAmount + s.otherGymAmount) * 100,
  ) / 100;

test("gym plan: all of it is membership income, no trainer share", () => {
  const s = oldMoneySplit(5800, { gym: { price: 7000 }, pt: null });
  assert.deepEqual(s, {
    trainerShareAmount: 0,
    gymAmount: 5800,
    membershipGymAmount: 5800,
    ptGymAmount: 0,
    otherGymAmount: 0,
  });
});

test("gym plan with no price here still counts as membership income", () => {
  const s = oldMoneySplit(1500, { gym: { price: 0 }, pt: null });
  assert.equal(s.membershipGymAmount, 1500);
  assert.equal(s.gymAmount, 1500);
});

test("PT plan: the trainer's share comes off at the PT plan's own rate", () => {
  // PT ₹6,000 here with a ₹3,000 trainer share (50%); ₹5,000 paid there.
  const s = oldMoneySplit(5000, { gym: null, pt: { price: 6000, trainerShare: 3000 } });
  assert.equal(s.trainerShareAmount, 2500);
  assert.equal(s.ptGymAmount, 2500);
  assert.equal(s.gymAmount, 2500);
  assert.equal(s.membershipGymAmount, 0);
  assert.equal(parts(s), 5000);
});

test("PT plan with no price here: no trainer share can be worked out", () => {
  const s = oldMoneySplit(4000, { gym: null, pt: { price: 0, trainerShare: 0 } });
  assert.equal(s.trainerShareAmount, 0);
  assert.equal(s.ptGymAmount, 4000);
});

test("one old plan for gym + PT: split by the two prices, parts add up exactly", () => {
  // Gym ₹2,000 + PT ₹3,000 (trainer ₹1,500) = ₹5,000; ₹3,333 paid there.
  const s = oldMoneySplit(3333, {
    gym: { price: 2000 },
    pt: { price: 3000, trainerShare: 1500 },
  });
  assert.equal(s.trainerShareAmount, 999.9);
  assert.equal(s.gymAmount, 2333.1);
  assert.equal(s.ptGymAmount, 999.9);
  assert.equal(s.membershipGymAmount, 1333.2);
  assert.equal(s.otherGymAmount, 0);
  assert.equal(parts(s), 3333);
});

test("rows: dates, amounts and the future are checked", () => {
  const today = "2026-10-08";
  assert.equal(checkOldRows([{ date: "2026-08-12", amount: 5800, method: "Other" }], today), "");
  assert.match(checkOldRows([], today), /at least one/i);
  assert.match(checkOldRows([{ date: "", amount: 100, method: "Cash" }], today), /day/i);
  assert.match(
    checkOldRows([{ date: "2026-10-09", amount: 100, method: "Cash" }], today),
    /future|after today/i,
  );
  assert.match(checkOldRows([{ date: "2026-10-01", amount: 0, method: "Cash" }], today), /amount/i);
  assert.match(
    checkOldRows([{ date: "2026-10-01", amount: -5, method: "Cash" }], today),
    /amount/i,
  );
  assert.match(
    checkOldRows([{ date: "2026-10-01", amount: 100, method: "Cheque" as never }], today),
    /mode/i,
  );
  const many = Array.from({ length: 13 }, () => ({
    date: "2026-09-01",
    amount: 10,
    method: "Cash" as const,
  }));
  assert.match(checkOldRows(many, today), /12/);
});

test("default rows: one payment on the plan's start day; a later start needs the real day", () => {
  assert.deepEqual(defaultOldRows("2026-08-12", 5800, "2026-10-08"), [
    { date: "2026-08-12", amount: 5800, method: "Other" },
  ]);
  // Never "today": staff must give the day it was paid there.
  assert.deepEqual(defaultOldRows("2026-10-20", 5800, "2026-10-08"), [
    { date: "", amount: 5800, method: "Other" },
  ]);
  assert.deepEqual(defaultOldRows("2026-08-12", 0, "2026-10-08"), []);
});

test("saving rows: kept rows are updated in place, new ones added, missing ones removed", () => {
  const existing = [
    { id: "a", date: "2026-08-12", amount: 5800, method: "Other" as const },
    { id: "b", date: "2026-09-01", amount: 1000, method: "Cash" as const },
  ];
  const d = diffOldRows(existing, [
    { id: "a", date: "2026-08-12", amount: 3000, method: "UPI" },
    { date: "2026-08-20", amount: 2800, method: "Cash" },
  ]);
  assert.deepEqual(d.update, [
    { id: "a", row: { id: "a", date: "2026-08-12", amount: 3000, method: "UPI" } },
  ]);
  assert.deepEqual(d.add, [{ date: "2026-08-20", amount: 2800, method: "Cash" }]);
  assert.deepEqual(d.remove, ["b"]);
  assert.equal(d.changed, true);
  const same = diffOldRows(existing, existing);
  assert.deepEqual(same.update, []);
  assert.equal(same.changed, false);
});

const gym = (o: Partial<OldPlanFact>): OldPlanFact => ({
  kind: "gym",
  id: "g1",
  clientId: "c1",
  clientName: "A",
  name: "1 Month",
  startDate: "2026-08-12",
  status: "active",
  paid: 1500,
  billNo: "",
  enrollmentId: "e1",
  invoiceId: "",
  price: 1500,
  trainerShare: 0,
  counted: false,
  ...o,
});
const pt = (o: Partial<OldPlanFact>): OldPlanFact =>
  gym({ kind: "pt", id: "p1", name: "PT 1 Month", price: 6000, trainerShare: 3000, ...o });

test("backfill: one payment per old plan on its start day, totals by month", () => {
  const b = planOldBackfill(
    [
      gym({ id: "g1", startDate: "2026-08-12", paid: 5800 }),
      gym({ id: "g2", clientId: "c2", enrollmentId: "e2", startDate: "2026-09-03", paid: 1500 }),
      gym({ id: "g3", clientId: "c3", enrollmentId: "e3", startDate: "2026-09-30", paid: 2000 }),
    ],
    "2026-10-08",
  );
  assert.equal(b.add.length, 3);
  assert.equal(b.total, 9300);
  assert.deepEqual(b.months, [
    { month: "2026-08", amount: 5800, plans: 1 },
    { month: "2026-09", amount: 3500, plans: 2 },
  ]);
  assert.equal(b.add[0]!.date, "2026-08-12");
  assert.equal(b.add[0]!.membershipId, "g1");
  assert.equal(b.add[0]!.ptAssignmentId, null);
  assert.equal(b.add[0]!.split.membershipGymAmount, 5800);
});

test("backfill: plans already counted, cancelled, or with no amount are not added", () => {
  const b = planOldBackfill(
    [
      gym({ id: "g1", counted: true }),
      gym({ id: "g2", clientId: "c2", enrollmentId: "e2", status: "cancelled" }),
      gym({ id: "g3", clientId: "c3", enrollmentId: "e3", paid: 0 }),
      gym({ id: "g4", clientId: "c4", enrollmentId: "e4", startDate: "" }),
    ],
    "2026-10-08",
  );
  assert.equal(b.add.length, 0);
  assert.equal(b.counted, 1);
  assert.deepEqual(
    b.skipped.map((s) => [s.id, s.reason]),
    [
      ["g2", "cancelled"],
      ["g3", "no-amount"],
      ["g4", "no-date"],
    ],
  );
});

test("backfill: a gym + PT plan joined together with the same amount is ONE old plan", () => {
  const b = planOldBackfill(
    [gym({ paid: 5000, price: 2000 }), pt({ paid: 5000, price: 3000, trainerShare: 1500 })],
    "2026-10-08",
  );
  assert.equal(b.add.length, 1);
  assert.equal(b.total, 5000);
  assert.equal(b.add[0]!.membershipId, "g1");
  assert.equal(b.add[0]!.ptAssignmentId, "p1");
  assert.equal(b.add[0]!.split.trainerShareAmount, 1500);
  assert.equal(b.add[0]!.split.membershipGymAmount, 2000);
});

test("backfill: a PT plan with no amount of its own on the gym plan's bill is counted with it", () => {
  const b = planOldBackfill(
    [
      gym({ paid: 8000, price: 6000, enrollmentId: "", invoiceId: "bill1" }),
      pt({ paid: 0, enrollmentId: "", invoiceId: "bill1", price: 2000, trainerShare: 1000 }),
    ],
    "2026-10-08",
  );
  assert.equal(b.add.length, 1);
  assert.equal(b.add[0]!.ptAssignmentId, "p1");
  assert.equal(b.add[0]!.split.trainerShareAmount, 1000);
  assert.deepEqual(b.skipped, []);
});

test("backfill: a separate PT plan (own amount) is its own payment", () => {
  const b = planOldBackfill(
    [gym({ paid: 1500 }), pt({ paid: 6000, enrollmentId: "e9", startDate: "2026-09-01" })],
    "2026-10-08",
  );
  assert.equal(b.add.length, 2);
  assert.equal(b.total, 7500);
  const p = b.add.find((a) => a.ptAssignmentId === "p1")!;
  assert.equal(p.membershipId, null);
  assert.equal(p.date, "2026-09-01");
  assert.equal(p.split.trainerShareAmount, 3000);
});

test("backfill: a PT plan alone with no amount is listed as not counted", () => {
  const b = planOldBackfill([pt({ paid: 0, enrollmentId: "e5" })], "2026-10-08");
  assert.equal(b.add.length, 0);
  assert.deepEqual(
    b.skipped.map((s) => s.reason),
    ["no-amount"],
  );
});

test("backfill: never a second payment for a PT plan whose gym partner already has the money", () => {
  // The gym plan was counted already (e.g. from Edit plan); its PT partner has the same amount.
  const b = planOldBackfill([gym({ paid: 5000, counted: true }), pt({ paid: 5000 })], "2026-10-08");
  assert.equal(b.add.length, 0);
  assert.deepEqual(
    b.skipped.map((s) => [s.id, s.reason]),
    [["p1", "with-gym-plan"]],
  );
});

test("backfill: never a second payment for a gym plan whose PT partner already has the money", () => {
  const b = planOldBackfill([gym({ paid: 5000 }), pt({ paid: 5000, counted: true })], "2026-10-08");
  assert.equal(b.add.length, 0);
  assert.deepEqual(
    b.skipped.map((s) => [s.id, s.reason]),
    [["g1", "with-pt-plan"]],
  );
});

test("backfill: a plan starting after today is left for staff to date (never counted today)", () => {
  const b = planOldBackfill([gym({ startDate: "2026-10-20" })], "2026-10-08");
  assert.equal(b.add.length, 0);
  assert.deepEqual(
    b.skipped.map((s) => s.reason),
    ["later-start"],
  );
});

test("backfill: one old plan whose gym plan was cancelled here still splits gym + PT", () => {
  const b = planOldBackfill(
    [
      gym({ status: "cancelled", paid: 15000, price: 10000 }),
      pt({ paid: 15000, price: 5000, trainerShare: 2500 }),
    ],
    "2026-10-08",
  );
  assert.equal(b.add.length, 1);
  assert.equal(b.add[0]!.membershipId, "g1");
  assert.equal(b.add[0]!.ptAssignmentId, "p1");
  assert.equal(b.add[0]!.split.trainerShareAmount, 2500);
  assert.equal(b.add[0]!.split.membershipGymAmount, 10000);
});

test("backfill: a cancelled plan that had money given back here was really paid: counted", () => {
  const b = planOldBackfill(
    [gym({ status: "cancelled", refunded: true, paid: 12000 })],
    "2026-10-08",
  );
  assert.equal(b.add.length, 1);
  assert.equal(b.total, 12000);
});

test("backfill: a pair is skipped only when both plans were cancelled", () => {
  const b = planOldBackfill(
    [gym({ status: "cancelled", paid: 5000 }), pt({ status: "cancelled", paid: 5000 })],
    "2026-10-08",
  );
  assert.equal(b.add.length, 0);
  assert.deepEqual(
    b.skipped.map((s) => [s.id, s.reason]),
    [
      ["g1", "cancelled"],
      ["p1", "with-gym-plan"],
    ],
  );
});

test("backfill: a second PT plan of the same old plan is never a second payment", () => {
  const b = planOldBackfill(
    [gym({ paid: 15000 }), pt({ id: "p1", paid: 15000 }), pt({ id: "p2", paid: 15000 })],
    "2026-10-08",
  );
  assert.equal(b.add.length, 1);
  assert.equal(b.total, 15000);
  assert.deepEqual(
    b.skipped.map((s) => [s.id, s.reason]),
    [["p2", "with-gym-plan"]],
  );
});

test("partner: the gym plan a PT plan was one old plan with", () => {
  const g = gym({ paid: 5000 });
  assert.equal(oldPartnerOf(pt({ paid: 5000 }), [g])?.id, "g1");
  assert.equal(oldPartnerOf(pt({ paid: 0 }), [g])?.id, "g1");
  // Its own amount: a separate old plan.
  assert.equal(oldPartnerOf(pt({ paid: 6000 }), [g]), null);
  // Not joined together and not on the same bill.
  assert.equal(oldPartnerOf(pt({ paid: 5000, enrollmentId: "e9" }), [g]), null);
  assert.equal(oldPartnerOf(pt({ paid: 5000, clientId: "c9" }), [g]), null);
});

test("backfill: the bill number and plan name travel with the payment", () => {
  const b = planOldBackfill([gym({ billNo: "344", name: "3 Month" })], "2026-10-08");
  assert.equal(b.add[0]!.billNo, "344");
  assert.equal(b.add[0]!.label, "3 Month");
});
