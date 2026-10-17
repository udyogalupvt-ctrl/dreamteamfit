// M1: bills keep their number, link and date; deleting bills and plans needs a delete right; the
// bill counter only ever takes the next number.
import { after, before, test } from "node:test";
import {
  env,
  seed,
  LOGINS,
  staff,
  owner,
  nobody,
  day,
  assertFails,
  assertSucceeds,
} from "./helpers.mjs";

let t;
const year = Number(day().slice(0, 4));
const K1 = `invoiceSeq${year}`;
const K0 = `invoiceSeq${year - 1}`;
const bill = (extra = {}) => ({
  invoiceNumber: "RF-2026-000041",
  publicToken: "tok1",
  invoiceDate: day(0),
  clientId: "c1",
  total: 3000,
  amountPaid: 1000,
  balanceDue: 2000,
  paymentStatus: "partial",
  ...extra,
});

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "invoices/i1": bill(),
    "publicInvoices/tok1": { invoiceNumber: "RF-2026-000041", total: 3000 },
    "settings/counters": { [K1]: 41, [K0]: 900, updatedAt: new Date() },
  });
});
after(() => t.cleanup());

test("invoices: number, link and date never change from the app", async () => {
  const desk = staff(t, "desk");
  await assertFails(desk.doc("invoices/i1").update({ invoiceNumber: "RF-2026-000001" }));
  await assertFails(desk.doc("invoices/i1").update({ publicToken: "x" }));
  await assertFails(desk.doc("invoices/i1").update({ invoiceDate: day(-90) }));
  await assertSucceeds(
    desk.doc("invoices/i1").update({ amountPaid: 3000, balanceDue: 0, paymentStatus: "paid" }),
  );
  await assertSucceeds(desk.collection("invoices").doc().set(bill({ invoiceNumber: "RF-2026-000042" })));
  await assertFails(desk.collection("invoices").doc().set(bill({ invoiceNumber: 42 })));
});

test("invoices and their public copies: deleting needs a delete right", async () => {
  await seed(t, {
    "invoices/i2": bill(),
    "invoices/i3": bill(),
    "invoices/i4": bill(),
    "publicInvoices/t2": { total: 1 },
    "publicInvoices/t3": { total: 1 },
  });
  await assertFails(staff(t, "desk").doc("invoices/i2").delete());
  await assertFails(staff(t, "fin").doc("invoices/i2").delete());
  await assertSucceeds(staff(t, "bills").doc("invoices/i2").delete());
  await assertSucceeds(staff(t, "delmem").doc("invoices/i3").delete());
  await assertSucceeds(staff(t, "plans").doc("invoices/i4").delete());
  await assertFails(staff(t, "desk").doc("publicInvoices/t2").delete());
  await assertSucceeds(staff(t, "bills").doc("publicInvoices/t2").delete());
  await assertSucceeds(staff(t, "delmem").doc("publicInvoices/t3").delete());
  await assertSucceeds(nobody(t).doc("publicInvoices/tok1").get()); // the bill's secret link
  await assertSucceeds(staff(t, "desk").doc("publicInvoices/t9").set({ total: 1 }));
});

test("plans: every desk adds and edits; deleting needs Delete plans or Delete members", async () => {
  for (const c of ["memberships", "ptAssignments", "enrollments"]) {
    await assertSucceeds(staff(t, "desk").doc(`${c}/a`).set({ clientId: "c1", status: "active" }));
    await assertSucceeds(staff(t, "desk").doc(`${c}/a`).update({ status: "cancelled" }));
    await assertFails(staff(t, "desk").doc(`${c}/a`).delete());
    await assertSucceeds(staff(t, "plans").doc(`${c}/a`).delete());
    await seed(t, { [`${c}/b`]: { clientId: "c1" } });
    await assertSucceeds(staff(t, "delmem").doc(`${c}/b`).delete());
  }
  await seed(t, { "enrollments/e9": { clientId: "c1" } });
  await assertSucceeds(staff(t, "bills").doc("enrollments/e9").delete());
});

test("bill counter: only the next number", async () => {
  const desk = staff(t, "desk");
  const at = new Date();
  await assertSucceeds(desk.doc("settings/counters").update({ [K1]: 42, updatedAt: at }));
  await assertSucceeds(desk.doc("settings/counters").set({ [K1]: 43, updatedAt: at }, { merge: true }));
  await assertFails(desk.doc("settings/counters").update({ [K1]: 1, updatedAt: at }));
  await assertFails(desk.doc("settings/counters").update({ [K1]: 45, updatedAt: at }));
  await assertSucceeds(desk.doc("settings/counters").update({ [K0]: 901, updatedAt: at }));
  await assertFails(desk.doc("settings/counters").update({ memberSeq: 5 }));
  await assertFails(desk.doc("settings/counters").delete());
  await assertFails(desk.doc("settings/business").set({ name: "Mine" }));
  await assertSucceeds(staff(t, "sett").doc("settings/counters").update({ [K1]: 1 }));
  await assertSucceeds(owner(t).doc("settings/counters").update({ [K1]: 44 }));
});

test("bill counter: a new year's number starts at 1", async () => {
  await seed(t, { "settings/counters": { [K0]: 900, updatedAt: new Date() } });
  const desk = staff(t, "desk");
  await assertFails(desk.doc("settings/counters").update({ [K1]: 2, updatedAt: new Date() }));
  await assertSucceeds(desk.doc("settings/counters").update({ [K1]: 1, updatedAt: new Date() }));
});

test("bill counter: a missing counters record may be started at 1", async () => {
  await t.withSecurityRulesDisabled((c) => c.firestore().doc("settings/counters").delete());
  const desk = staff(t, "desk");
  await assertFails(desk.doc("settings/counters").set({ [K1]: 7, updatedAt: new Date() }));
  await assertSucceeds(
    desk.doc("settings/counters").set({ [K1]: 1, updatedAt: new Date() }, { merge: true }),
  );
});

test("trainer payouts: whoever may delete them with a bill or member may read them", async () => {
  await seed(t, { "trainerPayouts/o1": { invoiceId: "i1", status: "pending", grossAmount: 1000 } });
  const q = (uid) => staff(t, uid).collection("trainerPayouts").where("invoiceId", "==", "i1").get();
  await assertSucceeds(q("bills"));
  await assertSucceeds(q("delmem"));
  await assertSucceeds(q("plans"));
  await assertSucceeds(q("fin"));
  await assertFails(q("desk"));
  await assertFails(staff(t, "desk").doc("trainerPayouts/o1").update({ status: "paid" }));
});

test("old untracked bills: only Finance lowers what was paid or untracks a bill", async () => {
  await seed(t, {
    "invoices/old1": bill({ amountPaid: 3000, balanceDue: 0, paymentStatus: "paid" }), // no paymentsTracked
    "invoices/new1": bill({ paymentsTracked: true }),
  });
  const desk = staff(t, "desk");
  await assertFails(desk.doc("invoices/old1").update({ amountPaid: 0 }));
  await assertFails(desk.doc("invoices/new1").update({ paymentsTracked: false }));
  await assertSucceeds(desk.doc("invoices/old1").update({ amountPaid: 3500, paymentsTracked: true })); // collect
  await assertSucceeds(desk.doc("invoices/new1").update({ amountPaid: 0, balanceDue: 3000 })); // undo on a tracked bill
  await seed(t, { "invoices/old2": bill({ amountPaid: 3000 }) });
  await assertSucceeds(staff(t, "fin").doc("invoices/old2").update({ amountPaid: 2000 }));
});
