import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickCurrent,
  planRemoval,
  type RemovalFacts,
  type RmBill,
  type RmPayment,
  type RmPayout,
  type RmPlan,
} from "./plan-remove.ts";

const TODAY = "2026-10-09";
const SALE_MS = Date.parse("2026-10-09T09:00:00+05:30");
const OPEN = "2026-09-01";

const gym = (o: Partial<RmPlan> = {}): RmPlan => ({
  kind: "gym",
  id: "G1",
  name: "Monthly",
  status: "active",
  startDate: "2026-10-09",
  endDate: "2026-11-08",
  invoiceId: "B1",
  enrollmentId: "E1",
  cancelId: "",
  createdMs: 0,
  updatedMs: 0,
  upgradedTo: "",
  originalEndDate: "",
  endedBy: "",
  ...o,
});
const pt = (o: Partial<RmPlan> = {}): RmPlan =>
  gym({
    kind: "pt",
    id: "P1",
    name: "Monthly PT (Daily)",
    invoiceId: "B2",
    enrollmentId: "E2",
    ...o,
  });
const bill = (o: Partial<RmBill> = {}): RmBill => ({
  id: "B1",
  invoiceNumber: "RF-2026-000081",
  membershipId: "G1",
  ptAssignmentId: "",
  enrollmentId: "E1",
  publicToken: "T1",
  total: 2500,
  upgradeCredit: 0,
  ...o,
});
const pay = (o: Partial<RmPayment> = {}): RmPayment => ({
  id: "PAY1",
  amount: 2500,
  paymentDate: "2026-10-09",
  method: "Cash",
  kind: "initial",
  oldSoftware: false,
  invoiceId: "B1",
  membershipId: "G1",
  ptAssignmentId: "",
  cancelId: "",
  ...o,
});
const payout = (o: Partial<RmPayout> = {}): RmPayout => ({
  id: "OUT1",
  trainerName: "Ravi",
  ptAssignmentId: "P1",
  invoiceId: "B2",
  cancelId: "",
  status: "pending",
  trainerShareAmount: 4000,
  ...o,
});
const facts = (o: Partial<RemovalFacts> = {}): RemovalFacts => ({
  target: { kind: "gym", id: "G1" },
  plans: [gym()],
  bills: [bill()],
  payments: [pay()],
  payouts: [],
  client: { currentId: "G1", enrollmentId: "" },
  today: TODAY,
  openFrom: OPEN,
  ...o,
});

test("a gym sale on its own bill: plan, bill, its public link, payment and joining record go", () => {
  const r = planRemoval(facts());
  assert.equal(r.error, "");
  assert.deepEqual(r.plans, [{ kind: "gym", id: "G1" }]);
  assert.deepEqual(r.billIds, ["B1"]);
  assert.deepEqual(r.publicTokens, ["T1"]);
  assert.deepEqual(r.paymentIds, ["PAY1"]);
  assert.deepEqual(r.enrollmentIds, ["E1"]);
  assert.deepEqual(r.putBack, []);
  // Nothing else: the member has no plan now.
  assert.deepEqual(r.current, { summary: null, active: false });
  assert.match(r.money, /go down by ₹2,500/);
  assert.ok(r.goes.some((l) => l.includes("RF-2026-000081")));
});

test("gym + PT on one bill: removing the PT takes the gym plan too, with the trainer share", () => {
  const r = planRemoval(
    facts({
      target: { kind: "pt", id: "P1" },
      plans: [gym(), pt({ invoiceId: "B1" })],
      bills: [bill({ ptAssignmentId: "P1", total: 12500 })],
      payments: [pay({ amount: 12500, ptAssignmentId: "P1" })],
      payouts: [payout({ invoiceId: "B1" })],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.plans.map((p) => p.id).sort(), ["G1", "P1"]);
  assert.deepEqual(r.payoutIds, ["OUT1"]);
  assert.deepEqual(r.paymentIds, ["PAY1"]);
});

test("Sri Devi: a cancelled PT with its refund: payment, refund and trainer share go, ₹0 net", () => {
  const r = planRemoval(
    facts({
      target: { kind: "pt", id: "P1" },
      plans: [
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          startDate: "2026-09-20",
          endDate: "2026-10-19",
        }),
        pt({ status: "cancelled", cancelId: "c1", invoiceId: "B2", enrollmentId: "E2" }),
      ],
      bills: [
        bill({
          id: "B0",
          invoiceNumber: "RF-2026-000070",
          membershipId: "G0",
          publicToken: "T0",
          enrollmentId: "E0",
        }),
        bill({
          id: "B2",
          invoiceNumber: "RF-2026-000082",
          membershipId: "",
          ptAssignmentId: "P1",
          publicToken: "T2",
          enrollmentId: "E2",
          total: 10000,
        }),
      ],
      payments: [
        pay({ id: "PAY0", invoiceId: "B0", membershipId: "G0", paymentDate: "2026-09-20" }),
        pay({ id: "PAY2", amount: 10000, invoiceId: "B2", membershipId: "", ptAssignmentId: "P1" }),
        pay({
          id: "REF1",
          amount: -10000,
          kind: "refund",
          invoiceId: "B2",
          membershipId: "",
          ptAssignmentId: "P1",
          cancelId: "c1",
        }),
      ],
      payouts: [payout({ cancelId: "c1", trainerShareAmount: 0 })],
      client: { currentId: "G0", enrollmentId: "" },
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.plans, [{ kind: "pt", id: "P1" }]);
  assert.deepEqual(r.billIds, ["B2"]);
  assert.deepEqual(r.paymentIds.sort(), ["PAY2", "REF1"]);
  assert.deepEqual(r.payoutIds, ["OUT1"]);
  assert.deepEqual(r.enrollmentIds, ["E2"]);
  // The gym plan is untouched and stays the current one.
  assert.equal(r.current, undefined);
  assert.match(r.money, /add up to ₹0/);
});

test("an old-software plan: its old payments go (they were never in the Day Book)", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({
          invoiceId: "",
          startDate: "2026-08-01",
          endDate: "2026-10-31",
        }),
      ],
      bills: [],
      payments: [
        pay({
          id: "OLD1",
          oldSoftware: true,
          invoiceId: "",
          paymentDate: "2026-08-01",
          amount: 6000,
        }),
        pay({
          id: "OLD2",
          oldSoftware: true,
          invoiceId: "",
          paymentDate: "2026-08-15",
          amount: 1000,
        }),
      ],
    }),
  );
  // Old money is never in a closed Day Book month: any day can go.
  assert.equal(r.error, "");
  assert.deepEqual(r.paymentIds.sort(), ["OLD1", "OLD2"]);
  assert.deepEqual(r.billIds, []);
  assert.match(r.money, /₹7,000 paid in the old software/);
  assert.doesNotMatch(r.money, /Day Book go/);
});

test("an old gym + PT pair sharing one old payment: removing the gym plan takes the PT too", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({ invoiceId: "", enrollmentId: "E5" }),
        pt({ invoiceId: "", enrollmentId: "E6" }),
      ],
      bills: [],
      payments: [pay({ id: "OLD1", oldSoftware: true, invoiceId: "", ptAssignmentId: "P1" })],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.plans.map((p) => p.id).sort(), ["G1", "P1"]);
  assert.deepEqual(r.enrollmentIds.sort(), ["E5", "E6"]);
});

test("one joining record is one sale: an old gym + PT with no money recorded go together", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({ invoiceId: "", enrollmentId: "E5" }),
        pt({ invoiceId: "", enrollmentId: "E5" }),
      ],
      bills: [],
      payments: [],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.plans.map((p) => p.id).sort(), ["G1", "P1"]);
  assert.match(r.money, /No money was recorded/);
});

test("cancelled together with a plan outside the sale: refused", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({ status: "cancelled", cancelId: "c9" }),
        pt({ invoiceId: "B7", status: "cancelled", cancelId: "c9" }),
      ],
      bills: [
        bill(),
        bill({ id: "B7", membershipId: "", ptAssignmentId: "P1", publicToken: "T7" }),
      ],
      payments: [pay()],
    }),
  );
  assert.match(r.error, /cancelled together with PT: Monthly PT \(Daily\)/);
  assert.match(r.error, /Restore it first/);
});

test("a trainer share already paid: refused (use Cancel)", () => {
  const r = planRemoval(
    facts({
      target: { kind: "pt", id: "P1" },
      plans: [pt({ invoiceId: "B2" })],
      bills: [bill({ id: "B2", membershipId: "", ptAssignmentId: "P1" })],
      payments: [pay({ invoiceId: "B2", membershipId: "", ptAssignmentId: "P1" })],
      payouts: [payout({ status: "paid" })],
    }),
  );
  assert.match(r.error, /Ravi was already paid ₹4,000/);
  assert.match(r.error, /use Cancel/);
});

test("a payment in a closed Day Book month: refused", () => {
  const r = planRemoval(facts({ payments: [pay({ paymentDate: "2026-08-20" })] }));
  assert.match(r.error, /20 Aug 2026 is in a closed Day Book month/);
});

test("an upgrade: the old plan gets its end date back and runs again", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          startDate: "2026-09-01",
          endDate: "2026-10-08",
          status: "expired",
          upgradedTo: "G1",
          originalEndDate: "2026-11-30",
        }),
        gym(),
      ],
      bills: [
        bill({ id: "B0", membershipId: "G0", publicToken: "T0" }),
        bill({ upgradeCredit: 900 }),
      ],
      payments: [pay()],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.putBack, [
    {
      kind: "gym",
      id: "G0",
      name: "Monthly",
      status: "active",
      endDate: "2026-11-30",
      clear: ["upgradedTo", "upgradeFrom", "upgradeCredit", "originalEndDate"],
      why: "upgrade",
    },
  ]);
  assert.deepEqual(r.current?.summary, {
    membershipId: "G0",
    packageName: "Monthly",
    startDate: "2026-09-01",
    endDate: "2026-11-30",
    status: "active",
  });
  assert.equal(r.current?.active, true);
});

test("an upgrade whose old plan is cancelled or gone: refused (Edit plan)", () => {
  const cancelled = planRemoval(
    facts({
      plans: [
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          status: "cancelled",
          cancelId: "c1",
          upgradedTo: "G1",
        }),
        gym(),
      ],
      bills: [bill({ upgradeCredit: 900 })],
    }),
  );
  assert.match(cancelled.error, /Edit plan/);
  const gone = planRemoval(facts({ bills: [bill({ upgradeCredit: 900 })] }));
  assert.match(gone.error, /Edit plan/);
});

test("a plan that was upgraded since: refused (remove the upgrade first)", () => {
  const r = planRemoval(
    facts({
      target: { kind: "gym", id: "G0" },
      plans: [
        gym({ id: "G0", invoiceId: "B0", enrollmentId: "E0", upgradedTo: "G1", status: "expired" }),
        gym({ name: "Yearly" }),
      ],
      bills: [bill({ id: "B0", membershipId: "G0" }), bill({ upgradeCredit: 900 })],
      payments: [pay({ id: "PAY0", invoiceId: "B0", membershipId: "G0" })],
    }),
  );
  assert.match(r.error, /upgraded to Yearly/);
});

test("a renewal that ended the running plan (stamped): that plan runs again", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          startDate: "2026-09-20",
          endDate: "2026-10-19",
          status: "expired",
          endedBy: "G1",
        }),
        gym(),
      ],
      bills: [bill({ id: "B0", membershipId: "G0", publicToken: "T0" }), bill()],
      payments: [pay()],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.putBack, [
    {
      kind: "gym",
      id: "G0",
      name: "Monthly",
      status: "active",
      endDate: "2026-10-19",
      clear: ["endedBy", "statusBeforeSale"],
      why: "renewal",
    },
  ]);
  assert.equal(r.current?.summary?.membershipId, "G0");
});

test("a renewal from before the stamp: the latest plan it cut short runs again", () => {
  const r = planRemoval(
    facts({
      plans: [
        gym({
          id: "GA",
          invoiceId: "BA",
          enrollmentId: "EA",
          startDate: "2026-07-01",
          endDate: "2026-07-31",
          status: "expired",
        }),
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          startDate: "2026-09-20",
          endDate: "2026-10-19",
          status: "expired",
          createdMs: 500,
          updatedMs: SALE_MS,
        }),
        gym({ createdMs: SALE_MS, updatedMs: SALE_MS }),
      ],
      bills: [bill()],
      payments: [pay()],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(
    r.putBack.map((p) => [p.id, p.status, p.why]),
    [["G0", "active", "renewal"]],
  );
  assert.equal(r.current?.summary?.membershipId, "G0");
});

test("legacy revive: not when another plan still runs, nor for a plan something else ended", () => {
  const stillRuns = planRemoval(
    facts({
      plans: [
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          startDate: "2026-09-20",
          endDate: "2026-10-19",
          status: "expired",
          updatedMs: SALE_MS,
        }),
        gym({
          id: "G2",
          invoiceId: "B9",
          enrollmentId: "E9",
          startDate: "2026-10-01",
          endDate: "2026-12-31",
        }),
        gym({ createdMs: SALE_MS }),
      ],
    }),
  );
  assert.deepEqual(stillRuns.putBack, []);
  // G0 was ended earlier by another sale (since cancelled), not by the one removed now.
  const other = planRemoval(
    facts({
      plans: [
        gym({
          id: "G0",
          invoiceId: "B0",
          enrollmentId: "E0",
          startDate: "2026-09-20",
          endDate: "2026-10-19",
          status: "expired",
          updatedMs: SALE_MS - 86_400_000,
        }),
        gym({ createdMs: SALE_MS, updatedMs: SALE_MS }),
      ],
      client: { currentId: "G1", enrollmentId: "" },
    }),
  );
  assert.deepEqual(other.putBack, []);
});

test("a refund noted against the bill from another cancellation stays", () => {
  const r = planRemoval(
    facts({
      plans: [gym(), pt({ invoiceId: "B7", status: "cancelled", cancelId: "c5" })],
      bills: [
        bill(),
        bill({ id: "B7", membershipId: "", ptAssignmentId: "P1", publicToken: "T7" }),
      ],
      payments: [
        pay(),
        // The PT's cancellation noted its refund against the member's newest bill (B1).
        pay({
          id: "REF9",
          amount: -3000,
          kind: "refund",
          invoiceId: "B1",
          membershipId: "",
          ptAssignmentId: "P1",
          cancelId: "c5",
        }),
      ],
    }),
  );
  assert.equal(r.error, "");
  assert.deepEqual(r.paymentIds, ["PAY1"]);
});

test("the member's joining record link is cleared when it goes", () => {
  const r = planRemoval(facts({ client: { currentId: "G1", enrollmentId: "E1" } }));
  assert.equal(r.clearEnrollment, true);
  const other = planRemoval(facts({ client: { currentId: "G1", enrollmentId: "E8" } }));
  assert.equal(other.clearEnrollment, false);
});

test("already removed: refused", () => {
  const r = planRemoval(facts({ target: { kind: "gym", id: "nope" } }));
  assert.match(r.error, /already removed/);
});

test("current plan: running (latest start) > upcoming (earliest) > latest ended > cancelled", () => {
  const p = (id: string, startDate: string, endDate: string, status: string) => ({
    id,
    name: id,
    startDate,
    endDate,
    status,
  });
  const ended = p("A", "2026-08-01", "2026-08-31", "expired");
  const running1 = p("B", "2026-09-15", "2026-10-14", "active");
  const running2 = p("C", "2026-10-01", "2026-10-30", "active");
  const soon = p("D", "2026-11-01", "2026-11-30", "pending");
  const later = p("E", "2026-12-01", "2026-12-31", "pending");
  const gone = p("F", "2026-10-01", "2026-12-31", "cancelled");
  assert.equal(pickCurrent([ended, running1, running2, soon], TODAY).summary?.membershipId, "C");
  assert.equal(pickCurrent([ended, later, soon], TODAY).summary?.status, "pending");
  assert.equal(pickCurrent([ended, later, soon], TODAY).summary?.membershipId, "D");
  assert.equal(pickCurrent([ended, gone], TODAY).summary?.status, "expired");
  assert.equal(pickCurrent([gone], TODAY).summary?.status, "cancelled");
  assert.equal(pickCurrent([], TODAY).summary, null);
  assert.equal(pickCurrent([running1], TODAY).active, true);
  assert.equal(pickCurrent([soon], TODAY).active, false);
});
