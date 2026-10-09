import assert from "node:assert/strict";
import { test } from "node:test";
import { remindsBalance, renewalReminderPlans, type ReminderPlan } from "./reminders.ts";
import { OLD_BALANCE_LINE } from "./old-money.ts";

const plan = (over: Partial<ReminderPlan> = {}): ReminderPlan => ({
  id: "m1",
  clientId: "c1",
  status: "active",
  endDate: "2026-10-16",
  ...over,
});
const T = "2026-10-16";

test("one running plan ending on the day: reminded", () => {
  assert.deepEqual(
    renewalReminderPlans([plan()], T).map((p) => p.id),
    ["m1"],
  );
});

test("audit 3: two running plans with the same end date get ONE reminder (same pick every run)", () => {
  const a = plan({ id: "b" });
  const b = plan({ id: "a" });
  assert.deepEqual(
    renewalReminderPlans([a, b], T).map((p) => p.id),
    ["a"],
  );
  assert.deepEqual(
    renewalReminderPlans([b, a], T).map((p) => p.id),
    ["a"],
  );
});

test("already renewed (a later plan, queued or waiting for the thumb): no reminder", () => {
  for (const status of ["pending", "biometric_pending", "active"])
    assert.deepEqual(
      renewalReminderPlans([plan(), plan({ id: "m2", status, endDate: "2026-11-15" })], T),
      [],
    );
});

test("a cancelled later plan doesn't count as renewed", () => {
  const later = plan({ id: "m2", status: "cancelled", endDate: "2026-11-15" });
  assert.equal(renewalReminderPlans([plan(), later], T).length, 1);
});

test("members are reminded separately; other end dates are not reminded", () => {
  const r = renewalReminderPlans(
    [
      plan(),
      plan({ id: "m2", clientId: "c2" }),
      plan({ id: "m3", clientId: "c3", endDate: "2026-10-20" }),
    ],
    T,
  );
  assert.deepEqual(
    r.map((p) => p.id),
    ["m1", "m2"],
  );
});

test("a plan not yet running that ends on the day is not reminded", () => {
  assert.deepEqual(renewalReminderPlans([plan({ status: "pending" })], T), []);
});

const oldBill = { items: [{ name: `${OLD_BALANCE_LINE} · Monthly` }], amountPaid: 0 };

test("audit 1: an old-software balance bill is not reminded until staff confirm it", () => {
  assert.equal(remindsBalance(oldBill), false);
  assert.equal(remindsBalance({ ...oldBill, remindOldBalance: true }), true);
  assert.equal(remindsBalance({ ...oldBill, remindOldBalance: false }), false);
});

test("an old balance bill with part collected here is reminded (the member agreed)", () => {
  assert.equal(remindsBalance({ ...oldBill, amountPaid: 500 }), true);
});

test("a normal sale's balance is reminded as before", () => {
  assert.equal(remindsBalance({ items: [{ name: "Monthly" }], amountPaid: 0 }), true);
  assert.equal(remindsBalance({ items: [{ name: "Monthly" }, { name: "PT" }] }), true);
  assert.equal(remindsBalance({}), true);
});
