// M1/S4: payments. Closed Day Book months never change; refunds and old-software money need
// Finance; a desk login edits or undoes only today's money; deleting needs a delete right.
import { after, before, test } from "node:test";
import {
  env,
  seed,
  LOGINS,
  staff,
  owner,
  day,
  closedDay,
  firstOfLastMonth,
  daysAgo,
  assertFails,
  assertSucceeds,
} from "./helpers.mjs";

let t;
const pay = (extra = {}) => ({
  clientId: "c1",
  clientNameSnapshot: "Ravi",
  invoiceId: "i1",
  invoiceNumber: "RF-2026-000001",
  amount: 2000,
  method: "Cash",
  paymentDate: day(0),
  kind: "initial",
  oldSoftware: false,
  note: "",
  createdByUid: "desk",
  createdAt: new Date(),
  ...extra,
});
const lastYear = () => `${Number(day().slice(0, 4)) - 1}-03-15`;

before(async () => {
  t = await env();
  await seed(t, LOGINS);
});
after(() => t.cleanup());

const add = (db, data) => db.collection("payments").doc().set(data);

test("create: today's money by any desk; open months only, even for the owner", async () => {
  await assertSucceeds(add(staff(t, "desk"), pay()));
  await assertSucceeds(add(staff(t, "desk"), pay({ kind: "balance", amount: 500 })));
  await assertSucceeds(add(staff(t, "desk"), pay({ paymentDate: firstOfLastMonth() })));
  await assertSucceeds(add(staff(t, "desk"), pay({ paymentDate: day(1) }))); // desk clock a bit ahead
  await assertFails(add(staff(t, "desk"), pay({ paymentDate: closedDay() })));
  await assertFails(add(owner(t), pay({ paymentDate: closedDay() })));
  await assertFails(add(staff(t, "desk"), pay({ paymentDate: day(3) })));
  await assertFails(add(staff(t, "desk"), pay({ kind: "gift" })));
  await assertFails(add(staff(t, "desk"), pay({ amount: "2000" })));
  await assertFails(add(staff(t, "desk"), pay({ paymentDate: "17-10-2026" })));
});

test("create: refunds need Finance", async () => {
  await assertFails(add(staff(t, "desk"), pay({ amount: -500, kind: "refund" })));
  await assertSucceeds(add(staff(t, "fin"), pay({ amount: -500, kind: "refund" })));
  await assertFails(add(staff(t, "fin"), pay({ amount: -500, kind: "refund", paymentDate: closedDay() })));
});

test("create: old-software money needs Finance (any date it was paid)", async () => {
  await assertFails(add(staff(t, "desk"), pay({ oldSoftware: true })));
  await assertFails(add(staff(t, "desk"), pay({ oldSoftware: true, paymentDate: lastYear() })));
  await assertSucceeds(add(staff(t, "fin"), pay({ oldSoftware: true, paymentDate: lastYear() })));
  // brought over from the old software on a plan that starts later
  await assertSucceeds(add(staff(t, "fin"), pay({ oldSoftware: true, paymentDate: day(20) })));
  // a plan removed by mistake, put back (Undo by the login that removed it)
  await assertSucceeds(add(staff(t, "plans"), pay({ oldSoftware: true, paymentDate: lastYear() })));
  await assertFails(add(staff(t, "bills"), pay({ oldSoftware: true, paymentDate: lastYear() })));
});

test("update: cash facts of today's money, by the desk", async () => {
  await seed(t, {
    "payments/today": pay(),
    "payments/old5": pay({ paymentDate: day(-5), createdAt: daysAgo(5) }),
    "payments/late": pay({ paymentDate: day(-5), createdAt: new Date() }), // typed today
    "payments/closed": pay({ paymentDate: closedDay(), createdAt: daysAgo(60) }),
    "payments/oldsw": pay({ paymentDate: lastYear(), oldSoftware: true, createdAt: daysAgo(60) }),
  });
  const desk = staff(t, "desk");
  await assertSucceeds(desk.doc("payments/today").update({ amount: 1500 }));
  await assertSucceeds(desk.doc("payments/today").update({ method: "UPI" }));
  await assertSucceeds(desk.doc("payments/late").update({ amount: 1800 }));
  await assertFails(desk.doc("payments/old5").update({ amount: 1500 }));
  await assertFails(desk.doc("payments/today").update({ amount: -100 }));
  await assertFails(desk.doc("payments/today").update({ paymentDate: closedDay() }));
  await assertFails(desk.doc("payments/today").update({ oldSoftware: true }));
  await assertFails(desk.doc("payments/today").update({ kind: "refund" }));
});

test("update: Finance edits any open-month money; nobody changes a closed month's cash", async () => {
  const fin = staff(t, "fin");
  await assertSucceeds(fin.doc("payments/old5").update({ amount: 1400 }));
  await assertSucceeds(fin.doc("payments/old5").update({ paymentDate: firstOfLastMonth() }));
  await assertFails(fin.doc("payments/closed").update({ amount: 1500 }));
  await assertFails(owner(t).doc("payments/closed").update({ amount: 1500 }));
  await assertFails(owner(t).doc("payments/closed").update({ paymentDate: day(0) }));
  await assertFails(owner(t).doc("payments/old5").update({ paymentDate: closedDay() }));
});

test("update: notes and split fields stay editable on any payment (Edit plan re-split)", async () => {
  const desk = staff(t, "desk");
  await assertSucceeds(desk.doc("payments/closed").update({ note: "checked" }));
  await assertSucceeds(desk.doc("payments/closed").update({ gymAmount: 1200, trainerShareAmount: 800 }));
  await assertSucceeds(desk.doc("payments/oldsw").update({ ptGymAmount: 100 }));
});

test("update: old-software money is Finance's, any date", async () => {
  await assertFails(staff(t, "desk").doc("payments/oldsw").update({ amount: 900 }));
  await assertSucceeds(staff(t, "fin").doc("payments/oldsw").update({ amount: 900 }));
  await assertFails(staff(t, "fin").doc("payments/oldsw").update({ oldSoftware: false }));
});

test("delete: undo your own balance typed today; a Cash + UPI part; a cancellation's refund", async () => {
  await seed(t, {
    "payments/bal": pay({ kind: "balance", createdByUid: "desk" }),
    "payments/bal2": pay({ kind: "balance", createdByUid: "desk2" }),
    "payments/balOld": pay({ kind: "balance", createdByUid: "desk", paymentDate: day(-1), createdAt: daysAgo(1) }),
    "payments/sale": pay({ kind: "initial", createdByUid: "desk" }),
    "payments/part": pay({ kind: "initial", splitId: "sp1" }),
    "payments/partOld": pay({ kind: "initial", splitId: "sp2", paymentDate: day(-3), createdAt: daysAgo(3) }),
    "payments/ref": pay({ kind: "refund", amount: -500, cancelId: "cx1", createdByUid: "fin" }),
    "payments/refNo": pay({ kind: "refund", amount: -500, createdByUid: "fin" }),
  });
  const desk = staff(t, "desk");
  await assertSucceeds(desk.doc("payments/bal").delete());
  await assertFails(desk.doc("payments/bal2").delete());
  await assertFails(desk.doc("payments/balOld").delete());
  await assertFails(desk.doc("payments/sale").delete());
  await assertSucceeds(desk.doc("payments/part").delete());
  await assertFails(desk.doc("payments/partOld").delete());
  await assertSucceeds(desk.doc("payments/ref").delete());
  await assertFails(desk.doc("payments/refNo").delete());
});

test("delete: delete rights in open months; old-software rows by Finance; closed months never", async () => {
  await seed(t, {
    "payments/o1": pay({ paymentDate: day(-5), createdAt: daysAgo(5) }),
    "payments/o2": pay({ paymentDate: firstOfLastMonth(), createdAt: daysAgo(40) }),
    "payments/c1": pay({ paymentDate: closedDay(), createdAt: daysAgo(60) }),
    "payments/sw": pay({ paymentDate: lastYear(), oldSoftware: true, createdAt: daysAgo(90) }),
    "payments/sw2": pay({ paymentDate: lastYear(), oldSoftware: true, createdAt: daysAgo(90) }),
    "payments/sw3": pay({ paymentDate: lastYear(), oldSoftware: true, createdAt: daysAgo(90) }),
  });
  await assertSucceeds(staff(t, "bills").doc("payments/o1").delete());
  await assertSucceeds(staff(t, "plans").doc("payments/o2").delete());
  await assertFails(owner(t).doc("payments/c1").delete());
  await assertFails(staff(t, "bills").doc("payments/c1").delete());
  await assertFails(staff(t, "desk").doc("payments/sw").delete());
  await assertSucceeds(staff(t, "fin").doc("payments/sw").delete());
  await assertSucceeds(staff(t, "delmem").doc("payments/sw2").delete());
  await assertFails(staff(t, "bills").doc("payments/sw3").delete());
  await assertSucceeds(staff(t, "plans").doc("payments/sw3").delete()); // Remove plan added by mistake
});

test("who typed a payment and when never change (so yesterday's money can't be 'undone')", async () => {
  await seed(t, {
    "payments/y1": pay({ kind: "balance", createdByUid: "desk2", paymentDate: day(-1), createdAt: daysAgo(1) }),
  });
  const desk = staff(t, "desk");
  await assertFails(desk.doc("payments/y1").update({ createdAt: new Date() }));
  await assertFails(desk.doc("payments/y1").update({ createdByUid: "desk" }));
  await assertFails(owner(t).doc("payments/y1").update({ createdAt: new Date() }));
  await assertFails(desk.doc("payments/y1").delete());
});

test("staff still read payments; everyday collections unchanged", async () => {
  await assertSucceeds(staff(t, "desk").collection("payments").where("clientId", "==", "c1").get());
  await assertSucceeds(staff(t, "desk").doc("inquiries/q1").set({ name: "Lead" }));
  await assertSucceeds(staff(t, "desk").doc("attendance/a1").set({ clientId: "c1" }));
});
