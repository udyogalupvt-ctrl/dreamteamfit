import assert from "node:assert/strict";
import { test } from "node:test";
import type { OldMember, OldPlan } from "./old-data.ts";
import {
  asIsBill,
  asIsKey,
  asIsMembership,
  asIsPayment,
  asIsPt,
  daysIncl,
  matchClient,
  oldPlanKind,
  planMigration,
  saleUnits,
  type MigrateInput,
  type Row,
  NOT_RECORDED,
} from "./old-migrate.ts";

const TODAY = "2026-10-10";

const plan = (o: Partial<OldPlan>): OldPlan => ({
  name: "6 MONTHS GYM",
  price: 6000,
  discount: 0,
  amount: 6000,
  balance: 0,
  start: "2026-07-01",
  end: "2026-12-31",
  nextPayment: "",
  status: "Active",
  counsellor: "",
  createdBy: "",
  bill: "344",
  remark: "",
  ...o,
});

const person = (o: Partial<OldMember>): OldMember => ({
  memberId: "77",
  name: "Ravi Kumar",
  phone: "9000000001",
  gender: "male",
  dob: "1990-01-01",
  married: "",
  anniversary: "",
  counsellor: "",
  email: "",
  address: "",
  remark: "",
  status: "Active",
  registeredOn: "2024-01-01",
  plans: [],
  ...o,
});

const row = (id: string, data: Record<string, unknown>): Row => ({ id, data });
const base = (o: Partial<MigrateInput>): MigrateInput => ({
  today: TODAY,
  phoneKey: "9000000001",
  oldMembers: [],
  clients: [],
  memberships: [],
  ptAssignments: [],
  invoices: [],
  payments: [],
  scope: "running",
  ...o,
});

test("kinds: gym / pt / pt with floor", () => {
  assert.equal(oldPlanKind("6 MONTHS GYM"), "gym");
  assert.equal(oldPlanKind("1 month alt pt"), "pt");
  assert.equal(oldPlanKind("PERSONAL TRAINING DAILY"), "pt");
  assert.equal(oldPlanKind("3 MONTHS PT + FLOOR"), "pair");
  assert.equal(oldPlanKind("pt + gym"), "pair");
});

test("days are counted with both ends; statuses and money follow the old record", () => {
  assert.equal(daysIncl("2026-10-01", "2026-10-30"), 30);
  assert.equal(daysIncl("2026-10-01", "2026-10-01"), 1);
  assert.equal(daysIncl("bad", "2026-10-01"), 0);
  const p = plan({ amount: 6000, balance: 1000 });
  const m = person({});
  const doc = asIsMembership(m, p, TODAY);
  assert.equal(doc["packageId"], "");
  assert.equal(doc["packageNameSnapshot"], "6 MONTHS GYM");
  assert.equal(doc["priceSnapshot"], 6000);
  assert.equal(doc["status"], "active");
  assert.equal(doc["oldSoftwarePaid"], 5000);
  assert.equal(doc["oldSoftwareBalance"], 1000);
  assert.equal(doc["oldPlanAsIs"], true);
  assert.equal(doc["oldPlanKey"], asIsKey("77", p));
  const pay = asIsPayment(p)!;
  assert.equal(pay["amount"], 5000);
  assert.equal(pay["method"], NOT_RECORDED);
  assert.equal(pay["paymentDate"], "2026-07-01");
  assert.equal(pay["oldSoftware"], true);
  assert.equal(pay["trainerShareAmount"], 0);
  const bill = asIsBill(p)!;
  assert.equal(bill["total"], 1000);
  assert.equal(bill["balanceDue"], 1000);
  assert.equal(bill["paymentStatus"], "pending");
  assert.equal(asIsBill(plan({ balance: 0 })), null);
  assert.equal(asIsPayment(plan({ amount: 1000, balance: 1000 })), null);
});

test("an as-is PT plan has no trainer and no share", () => {
  const p = plan({ name: "1 month alt pt", amount: 4000, balance: 0, end: "2026-10-05" });
  const doc = asIsPt(person({}), p, TODAY);
  assert.equal(doc["trainerId"], "");
  assert.equal(doc["trainerShareAmount"], 0);
  assert.equal(doc["ptPrice"], 4000);
  assert.equal(doc["status"], "completed");
});

test("case 1: not in the app + running plan → create member + carry", () => {
  const m = person({ plans: [plan({ balance: 500 })] });
  const r = planMigration(base({ oldMembers: [m] }));
  assert.equal(r.members.length, 1);
  const mem = r.members[0]!;
  assert.equal(mem.clientId, null);
  assert.equal(mem.client!.desiredCode, "77");
  assert.equal(mem.client!.draft["fullName"], "Ravi Kumar");
  assert.equal(mem.client!.draft["oldMemberId"], "77");
  assert.equal(mem.carries.length, 1);
  assert.ok(mem.carries[0]!.membership);
  assert.equal(mem.carries[0]!.pt, null);
  assert.ok(mem.carries[0]!.payment);
  assert.ok(mem.carries[0]!.bill);
});

test("a letter member ID is not forced into the Member ID", () => {
  const m = person({ memberId: "IIFM12", plans: [plan({})] });
  const r = planMigration(base({ oldMembers: [m] }));
  assert.equal(r.members[0]!.client!.desiredCode, null);
});

test("case 2: ended plans only → nothing now, listed for the first visit", () => {
  const m = person({ plans: [plan({ start: "2026-01-01", end: "2026-06-30" })] });
  const r = planMigration(base({ oldMembers: [m] }));
  assert.equal(r.members.length, 0);
  assert.ok(r.skips.some((s) => s.reason.includes("first visit")));
});

test("first visit (scope latest): the latest ended plan is carried", () => {
  const m = person({ plans: [plan({ start: "2026-01-01", end: "2026-06-30" })] });
  const r = planMigration(base({ oldMembers: [m], scope: "latest" }));
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0]!.carries.length, 1);
  assert.equal(r.members[0]!.carries[0]!.membership!["status"], "expired");
});

test("case 3: already carried (oldPlanKey) → no change at all", () => {
  const p = plan({});
  const m = person({ plans: [p] });
  const client = row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [client],
      memberships: [row("m1", { clientId: "c1", oldPlanKey: asIsKey("77", p), paidInOldSoftware: true, oldPlanAsIs: true, startDate: p.start, endDate: p.end })],
    }),
  );
  assert.equal(r.members.length, 0);
});

test("case 4: hand-entered wrong package/dates/amount → fixed in place, exact payment replaces the old rows", () => {
  const p = plan({ amount: 6000, balance: 1000, start: "2026-07-01", end: "2026-12-31" });
  const m = person({ plans: [p] });
  const client = row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [client],
      memberships: [
        row("m1", {
          clientId: "c1",
          packageId: "pkg6m",
          packageNameSnapshot: "6 months cardio",
          priceSnapshot: 5999,
          startDate: "2026-07-03",
          endDate: "2027-01-02",
          status: "active",
          paidInOldSoftware: true,
          oldSoftwarePaid: 4999,
          invoiceId: "i1",
        }),
      ],
      invoices: [row("i1", { clientId: "c1", total: 1000, amountPaid: 0, items: [{ name: "Balance from the old software · 6 months cardio" }] })],
      payments: [row("p1", { clientId: "c1", membershipId: "m1", oldSoftware: true, amount: 4999, method: "Other", paymentDate: "2026-07-03", edits: [] })],
    }),
  );
  assert.equal(r.members.length, 1);
  const fix = r.members[0]!.fixes[0]!;
  assert.equal(fix.membershipId, "m1");
  assert.equal(fix.membership!["packageNameSnapshot"], "6 MONTHS GYM");
  assert.equal(fix.membership!["priceSnapshot"], 6000);
  assert.equal(fix.membership!["startDate"], "2026-07-01");
  assert.equal(fix.deletePaymentIds[0], "p1");
  assert.equal(fix.keepPayments, false);
  assert.equal(fix.payment!["amount"], 5000);
  assert.equal(fix.billAction, "rewrite");
  assert.equal(fix.invoiceId, "i1");
});

test("old rows staff set by hand (right total, real modes) are kept", () => {
  const p = plan({ amount: 6000, balance: 0 });
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m1", { clientId: "c1", packageId: "x", packageNameSnapshot: "6 months", startDate: p.start, endDate: p.end, status: "active", paidInOldSoftware: true }),
      ],
      payments: [
        row("p1", { clientId: "c1", membershipId: "m1", oldSoftware: true, amount: 4000, method: "Cash", paymentDate: "2026-07-01", edits: [] }),
        row("p2", { clientId: "c1", membershipId: "m1", oldSoftware: true, amount: 2000, method: "UPI", paymentDate: "2026-08-01", edits: [] }),
      ],
    }),
  );
  const fix = r.members[0]!.fixes[0]!;
  assert.equal(fix.keepPayments, true);
  assert.equal(fix.payment, null);
  assert.deepEqual(fix.deletePaymentIds, []);
});

test("money collected here stays and the balance bill keeps it; collected more than the balance → owner decides", () => {
  const p = plan({ amount: 6000, balance: 2000 });
  const m = person({ plans: [p] });
  const mk = (paidHere: number) =>
    planMigration(
      base({
        oldMembers: [m],
        clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
        memberships: [
          row("m1", { clientId: "c1", packageId: "x", packageNameSnapshot: "6 months", startDate: p.start, endDate: p.end, status: "active", paidInOldSoftware: true, invoiceId: "i1" }),
        ],
        invoices: [row("i1", { clientId: "c1", total: 2000, amountPaid: paidHere, items: [{ name: "Balance from the old software · 6 months" }] })],
        payments: [row("pHere", { clientId: "c1", invoiceId: "i1", membershipId: "m1", amount: paidHere, method: "Cash", paymentDate: "2026-10-05", kind: "balance" })],
      }),
    );
  const ok = mk(1500);
  const fix = ok.members[0]!.fixes[0]!;
  assert.equal(fix.paidHere, 1500);
  assert.equal(fix.bill!["balanceDue"], 500);
  assert.equal(fix.bill!["paymentStatus"], "partial");
  assert.deepEqual(fix.repointPaymentIds, ["pHere"]);
  assert.ok(!fix.deletePaymentIds.includes("pHere"));
  const bad = mk(2500);
  assert.equal(bad.members.length, 0);
  assert.ok(bad.skips.some((s) => s.reason.includes("owner decides")));
});

test("case 5: a second copy of the same old plan goes to the Recycle Bin; one with money here does not", () => {
  const p = plan({});
  const m = person({ plans: [p] });
  const mk = (copyPayments: Row[]) =>
    planMigration(
      base({
        oldMembers: [m],
        clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
        memberships: [
          row("m1", { clientId: "c1", packageId: "x", packageNameSnapshot: "copy A", startDate: p.start, endDate: p.end, status: "active", paidInOldSoftware: true }),
          row("m2", { clientId: "c1", packageId: "y", packageNameSnapshot: "copy B", startDate: "2026-07-02", endDate: p.end, status: "active", paidInOldSoftware: true }),
        ],
        payments: copyPayments,
      }),
    );
  const clean = mk([]);
  assert.equal(clean.members[0]!.fixes.length, 1);
  assert.equal(clean.members[0]!.recycles.length, 1);
  assert.equal(clean.members[0]!.recycles[0]!.membershipId, "m2");
  const withMoney = mk([row("px", { clientId: "c1", membershipId: "m2", amount: 500, method: "Cash", paymentDate: "2026-10-01" })]);
  assert.equal(withMoney.members[0]!.recycles.length, 0);
  assert.ok(withMoney.skips.some((s) => s.reason.includes("money was taken here on it")));
});

test("an unpaid sale typed for the same days is recycled only once the old plan is confirmed in the app", () => {
  const p = plan({});
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m1", { clientId: "c1", packageId: "x", packageNameSnapshot: "entered", startDate: p.start, endDate: p.end, status: "active", paidInOldSoftware: true }),
        row("m2", { clientId: "c1", packageId: "y", packageNameSnapshot: "unpaid sale", startDate: "2026-07-01", endDate: "2026-12-31", status: "active", invoiceId: "i2" }),
      ],
      invoices: [row("i2", { clientId: "c1", total: 6000, amountPaid: 0 })],
    }),
  );
  assert.ok(r.members[0]!.recycles.some((x) => x.membershipId === "m2"));
});

test("a cancelled hand-entry is listed and the running plan is carried fresh", () => {
  const p = plan({});
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m1", { clientId: "c1", packageNameSnapshot: "cancelled one", startDate: p.start, endDate: p.end, status: "cancelled", cancelId: "x", paidInOldSoftware: true }),
      ],
    }),
  );
  assert.ok(r.skips.some((s) => s.reason.includes("cancelled here")));
  assert.equal(r.members[0]!.carries.length, 1);
});

test("an upgraded hand-entry blocks both the fix and a fresh carry (owner decides)", () => {
  const p = plan({});
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m2", { clientId: "c1", packageNameSnapshot: "upgraded one", startDate: p.start, endDate: p.end, status: "active", upgradedTo: "m9", paidInOldSoftware: true }),
      ],
    }),
  );
  assert.ok(r.skips.some((s) => s.reason.includes("upgraded here")));
  assert.equal(r.members.length, 0);
});

test("shape change: an old PT plan entered as a gym plan → PT created, the gym copy deleted", () => {
  const p = plan({ name: "1 MONTH PT", amount: 4000, start: "2026-10-01", end: "2026-10-30" });
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m1", { clientId: "c1", packageId: "x", packageNameSnapshot: "monthly", startDate: p.start, endDate: p.end, status: "active", paidInOldSoftware: true }),
      ],
    }),
  );
  const fix = r.members[0]!.fixes[0]!;
  assert.equal(fix.kind, "pt");
  assert.equal(fix.membership, null);
  assert.equal(fix.membershipId, null);
  assert.equal(fix.deleteMembershipId, "m1");
  assert.ok(fix.pt);
  assert.equal(fix.ptAssignmentId, null); // a new PT doc is created
});

test("pair: PT + floor carries a membership and a PT that share one payment", () => {
  const p = plan({ name: "3 MONTHS PT + FLOOR", amount: 12000, balance: 0, start: "2026-09-01", end: "2026-11-30" });
  const m = person({ plans: [p] });
  const r = planMigration(base({ oldMembers: [m] }));
  const carry = r.members[0]!.carries[0]!;
  assert.ok(carry.membership);
  assert.ok(carry.pt);
  assert.equal(carry.membership!["priceSnapshot"], 12000);
  assert.equal(carry.pt!["ptPrice"], 0);
  assert.equal(carry.payment!["membershipGymAmount"], 12000);
});

test("case 8: a renewal sold here for the same days is never touched; the carried plan lists it as overlapOk", () => {
  const p = plan({ start: "2026-09-15", end: "2026-10-14" });
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("mNew", { clientId: "c1", packageId: "pkg", packageNameSnapshot: "Monthly package", startDate: "2026-10-05", endDate: "2026-11-04", status: "active" }),
      ],
      payments: [row("pNew", { clientId: "c1", membershipId: "mNew", amount: 2000, method: "UPI", paymentDate: "2026-10-05" })],
    }),
  );
  const mem = r.members[0]!;
  assert.equal(mem.fixes.length, 0);
  assert.equal(mem.recycles.length, 0);
  assert.deepEqual(mem.carries[0]!.overlapWith, ["mNew"]);
});

test("case 7: old-marked plan with no old plan behind it → listed, not changed", () => {
  const m = person({ plans: [plan({ start: "2026-01-01", end: "2026-03-31" })] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m1", { clientId: "c1", packageNameSnapshot: "October money", startDate: "2026-10-05", endDate: "2026-11-04", status: "active", paidInOldSoftware: true }),
      ],
    }),
  );
  assert.equal(r.members.length, 0);
  assert.ok(r.skips.some((s) => s.reason.includes("no such plan")));
});

test("case 9: a family phone — one matched by name, the other created", () => {
  const p1 = plan({});
  const p2 = plan({ name: "3 MONTHS GYM", amount: 3000, start: "2026-09-01", end: "2026-11-30" });
  const husband = person({ memberId: "77", name: "Ravi Kumar", plans: [p1] });
  const wife = person({ memberId: "78", name: "Lakshmi Devi", plans: [p2] });
  const r = planMigration(
    base({
      oldMembers: [husband, wife],
      clients: [row("c1", { fullName: "Ravi Kumar" })],
      memberships: [
        row("m1", { clientId: "c1", packageNameSnapshot: "six", startDate: p1.start, endDate: p1.end, status: "active", paidInOldSoftware: true }),
      ],
    }),
  );
  assert.equal(r.members.length, 2);
  const ravi = r.members.find((x) => x.old.memberId === "77")!;
  const lakshmi = r.members.find((x) => x.old.memberId === "78")!;
  assert.equal(ravi.clientId, "c1");
  assert.equal(ravi.fixes.length, 1);
  assert.equal(lakshmi.clientId, null);
  assert.equal(lakshmi.client!.draft["fullName"], "Lakshmi Devi");
});

test("matchClient: oldMemberId wins; an unclear name match links nobody", () => {
  const m = person({ memberId: "5", name: "Ravi Kumar" });
  assert.equal(matchClient([row("a", { fullName: "Someone Else", oldMemberId: "5" })], m)!.id, "a");
  assert.equal(matchClient([row("a", { fullName: "Suresh Babu" })], m), null);
  assert.equal(
    matchClient([row("a", { fullName: "Ravi Teja" }), row("b", { fullName: "Ravi Varma" })], m),
    null,
  );
});

test("sale units: gym + PT sold together stay one unit", () => {
  const units = saleUnits(
    [row("m1", { enrollmentId: "e1", invoiceId: "i1" })],
    [row("t1", { enrollmentId: "e1", invoiceId: "i1" })],
    [row("i1", {})],
    [row("p1", { membershipId: "m1", ptAssignmentId: "t1" })],
  );
  assert.equal(units.length, 1);
  assert.equal(units[0]!.membership!.id, "m1");
  assert.equal(units[0]!.pt!.id, "t1");
  assert.equal(units[0]!.payments.length, 1);
});

test("the invariant: no plan ever deletes or edits money taken here", () => {
  const p = plan({ amount: 6000, balance: 2000 });
  const m = person({ plans: [p] });
  const r = planMigration(
    base({
      oldMembers: [m],
      clients: [row("c1", { fullName: "Ravi Kumar", oldMemberId: "77" })],
      memberships: [
        row("m1", { clientId: "c1", packageNameSnapshot: "six", startDate: p.start, endDate: p.end, status: "active", paidInOldSoftware: true, invoiceId: "i1" }),
      ],
      invoices: [row("i1", { clientId: "c1", total: 2000, amountPaid: 500, items: [{ name: "Balance from the old software · six" }] })],
      payments: [
        row("pOld", { clientId: "c1", membershipId: "m1", oldSoftware: true, amount: 4000, method: "Other", paymentDate: p.start, edits: [] }),
        row("pHere", { clientId: "c1", invoiceId: "i1", membershipId: "m1", amount: 500, method: "Cash", paymentDate: "2026-10-05", kind: "balance" }),
      ],
    }),
  );
  for (const mem of r.members)
    for (const fix of mem.fixes) {
      assert.ok(!fix.deletePaymentIds.includes("pHere"));
      if (fix.payment) assert.equal(fix.payment["oldSoftware"], true);
    }
});
