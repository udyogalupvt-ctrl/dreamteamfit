import { after, before, test } from "node:test";
import {
  env,
  seed,
  LOGINS,
  owner,
  staff,
  nobody,
  day,
  assertFails,
  assertSucceeds,
} from "./helpers.mjs";

let t;
const link = (over = {}) => ({
  clientId: "c1",
  clientName: "Ravi",
  memberCode: "101",
  kind: "balance",
  invoiceId: "i1",
  invoiceNumber: "INV-1",
  invoiceToken: "tok",
  packageId: "",
  packageName: "",
  planSeq: 1,
  amount: 500,
  status: "member_paid",
  closedReason: "",
  utr: "452109876543",
  utrSeenBefore: false,
  memberAmount: 500,
  memberPaidAt: new Date(),
  paidTimes: [Date.now()],
  deskNote: "",
  paymentIds: [],
  saleBillId: "",
  checkedBy: "",
  checkedByUid: "",
  checkedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresOn: day(30),
  ...over,
});
const payment = (over = {}) => ({
  clientId: "c1",
  invoiceId: "i1",
  amount: 500,
  method: "upi",
  paymentDate: day(),
  kind: "balance",
  createdBy: "Desk",
  createdByUid: "desk",
  createdAt: new Date(),
  ...over,
});
const checked = (uid) => ({
  checkedBy: "Desk",
  checkedByUid: uid,
  checkedAt: new Date(),
  updatedAt: new Date(),
});

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "payLinks/waiting1": link(),
    "payLinks/waiting2": link(),
    "payLinks/waiting3": link(),
    "payLinks/open1": link({ status: "open", utr: "", memberAmount: 0, memberPaidAt: null }),
    "payLinks/done1": link({ status: "confirmed", paymentIds: ["p1"] }),
    "payLinks/done2": link({ status: "confirmed", paymentIds: ["p2"] }),
    "payments/p1": payment({ payLinkId: "done1" }),
    "payLinks/waiting4": link(),
    "payLinks/renew1": link({ kind: "renewal", clientId: "c2", invoiceId: "", invoiceNumber: "" }),
    "payLinks/done3": link({ status: "confirmed", paymentIds: ["p6", "p7"] }),
    "payLinks/done4": link({ status: "confirmed", paymentIds: ["p8", "p9"] }),
    "payments/old1": payment({ payLinkId: "waiting4" }),
    "payments/plain1": payment(),
    "payments/p7": payment({ payLinkId: "done3" }),
  });
});
after(() => t.cleanup());

test("Billing reads pay links; other logins and the public don't", async () => {
  await assertSucceeds(staff(t, "desk").doc("payLinks/waiting1").get());
  await assertSucceeds(
    staff(t, "desk").collection("payLinks").where("status", "==", "member_paid").get(),
  );
  await assertFails(staff(t, "sett").doc("payLinks/waiting1").get());
  await assertFails(staff(t, "off").doc("payLinks/waiting1").get());
  await assertFails(nobody(t).doc("payLinks/waiting1").get());
});

test("nobody makes or deletes a pay link from a browser", async () => {
  await assertFails(owner(t).doc("payLinks/new1").set(link()));
  await assertFails(
    staff(t, "desk")
      .doc("payLinks/new2")
      .set(link({ status: "open" })),
  );
  await assertFails(owner(t).doc("payLinks/open1").delete());
});

test("not received: back to open with the desk's note, nothing else", async () => {
  const desk = staff(t, "desk");
  const back = {
    status: "open",
    deskNote: "Not in our account",
    utr: "",
    utrSeenBefore: false,
    memberAmount: 0,
    memberPaidAt: null,
    ...checked("desk"),
  };
  await assertFails(desk.doc("payLinks/waiting1").update({ ...back, deskNote: "x".repeat(201) }));
  await assertFails(desk.doc("payLinks/waiting1").update({ ...back, amount: 1 }));
  await assertFails(staff(t, "sett").doc("payLinks/waiting1").update(back));
  await assertSucceeds(desk.doc("payLinks/waiting1").update(back));
  // An open link can't be confirmed or put back.
  await assertFails(
    desk.doc("payLinks/open1").update({ status: "member_paid", ...checked("desk") }),
  );
});

test("confirm only with its payment written in the same go", async () => {
  const desk = staff(t, "desk");
  const done = (pid) => ({
    status: "confirmed",
    paymentIds: [pid],
    saleBillId: "",
    ...checked("desk"),
  });
  // No payment, or a payment that names another link: refused.
  await assertFails(desk.doc("payLinks/waiting2").update(done("nope")));
  const other = desk.batch();
  other.set(desk.doc("payments/p3"), payment({ payLinkId: "waiting3" }));
  other.update(desk.doc("payLinks/waiting2"), done("p3"));
  await assertFails(other.commit());
  // A payment already there for another link can't be borrowed either.
  await assertFails(desk.doc("payLinks/waiting2").update(done("p1")));
  const ok = desk.batch();
  ok.set(desk.doc("payments/p4"), payment({ payLinkId: "waiting2" }));
  ok.update(desk.doc("payLinks/waiting2"), done("p4"));
  await assertSucceeds(ok.commit());
  // Confirmed links stay put (no extra keys, no second confirm).
  await assertFails(desk.doc("payLinks/waiting2").update({ amount: 1 }));
});

test("confirm needs new money for this bill or member, never an old payment", async () => {
  const desk = staff(t, "desk");
  const done = (...ids) => ({
    status: "confirmed",
    paymentIds: ids,
    saleBillId: "",
    ...checked("desk"),
  });
  const tryWith = (linkId, pays, ids = Object.keys(pays)) => {
    const b = desk.batch();
    for (const [pid, p] of Object.entries(pays)) b.set(desk.doc(`payments/${pid}`), p);
    b.update(desk.doc(`payLinks/${linkId}`), done(...ids));
    return b.commit();
  };
  // An old payment can't be re-tagged to a link, and one already tagged doesn't count.
  await assertFails(desk.doc("payments/plain1").update({ payLinkId: "waiting4" }));
  await assertSucceeds(desk.doc("payments/plain1").update({ note: "ok" }));
  await assertFails(desk.doc("payLinks/waiting4").update(done("old1")));
  // Another bill, nothing paid, or a second part for another bill: refused.
  await assertFails(
    tryWith("waiting4", { n1: payment({ payLinkId: "waiting4", invoiceId: "i9" }) }),
  );
  await assertFails(tryWith("waiting4", { n2: payment({ payLinkId: "waiting4", amount: 0 }) }));
  await assertFails(
    tryWith("waiting4", {
      n3: payment({ payLinkId: "waiting4", amount: 300 }),
      n4: payment({ payLinkId: "waiting4", amount: 200, invoiceId: "i9" }),
    }),
  );
  await assertFails(
    tryWith("waiting4", { n5: payment({ payLinkId: "waiting4" }) }, ["n5", "old1"]),
  );
  await assertSucceeds(
    tryWith("waiting4", {
      n6: payment({ payLinkId: "waiting4", amount: 300 }),
      n7: payment({ payLinkId: "waiting4", amount: 200, method: "cash" }),
    }),
  );
  // A renewal link: the new payment must be the same member's.
  const renew = (over) =>
    payment({ payLinkId: "renew1", clientId: "c2", invoiceId: "s1", kind: "initial", ...over });
  await assertFails(tryWith("renew1", { r1: renew({ clientId: "c1" }) }));
  await assertSucceeds(tryWith("renew1", { r2: renew() }));
});

test("Undo puts a confirmed link back only once its payment is gone", async () => {
  const desk = staff(t, "desk");
  const back = { status: "member_paid", paymentIds: [], saleBillId: "", ...checked("desk") };
  await assertFails(desk.doc("payLinks/done1").update(back));
  await assertSucceeds(desk.doc("payLinks/done2").update(back));
  // Cash + UPI: both parts must be gone.
  await assertFails(desk.doc("payLinks/done3").update(back));
  await assertSucceeds(desk.doc("payLinks/done4").update(back));
});

test("UPI ID: owner only, the right shape; staff read it", async () => {
  const upi = {
    upiId: "gym.fit@okhdfcbank",
    payeeName: "Rebuild Fitness",
    updatedAt: new Date(),
    updatedBy: "Owner",
  };
  await assertSucceeds(owner(t).doc("settings/upi").set(upi));
  await assertSucceeds(
    owner(t)
      .doc("settings/upi")
      .set({ ...upi, upiId: "", payeeName: "" }),
  );
  await assertFails(staff(t, "sett").doc("settings/upi").set(upi));
  await assertFails(staff(t, "all").doc("settings/upi").set(upi));
  await assertFails(
    owner(t)
      .doc("settings/upi")
      .set({ ...upi, upiId: "not a upi" }),
  );
  await assertFails(
    owner(t)
      .doc("settings/upi")
      .set({ ...upi, payeeName: "" }),
  );
  await assertFails(
    owner(t)
      .doc("settings/upi")
      .set({ ...upi, payeeName: "x".repeat(51) }),
  );
  await assertFails(
    owner(t)
      .doc("settings/upi")
      .set({ ...upi, extra: 1 }),
  );
  await assertSucceeds(staff(t, "desk").doc("settings/upi").get());
});
