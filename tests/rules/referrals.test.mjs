import { after, before, test } from "node:test";
import {
  env,
  seed,
  LOGINS,
  owner,
  staff,
  nobody,
  assertFails,
  assertSucceeds,
} from "./helpers.mjs";

let t;
const due = {
  referrerId: "r1",
  referrerName: "Ravi",
  referrerCode: "101",
  newClientId: "n1",
  newClientName: "Sita",
  newClientCode: "205",
  joinedOn: "2026-10-22",
  status: "due",
  reward: null,
  reason: "",
  decidedBy: "",
  decidedAt: null,
  givenOn: "",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const reward = { kind: "free_days", days: 7, amount: 0, note: "" };
const given = {
  ...due,
  newClientId: "n2",
  status: "given",
  reward,
  decidedBy: "Owner",
  givenOn: "2026-10-22",
};

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "staffAccess/refs": { active: true, admin: false, permissions: ["members", "referrals"] },
    "referrals/n1": due,
    "referrals/n2": given,
    "referrals/n3": { ...due, newClientId: "n3" },
  });
});
after(() => t.cleanup());

test("the desk (Members) adds a referral with the new member and can move it while due", async () => {
  const desk = staff(t, "desk");
  await assertSucceeds(desk.doc("referrals/n9").set({ ...due, newClientId: "n9" }));
  await assertSucceeds(desk.collection("referrals").where("status", "==", "due").get());
  await assertSucceeds(
    desk
      .doc("referrals/n1")
      .update({ referrerId: "r2", referrerName: "Hari", referrerCode: "7", updatedAt: new Date() }),
  );
  await assertSucceeds(desk.doc("referrals/n9").delete());
});

test("the desk can't decide rewards, touch decided ones or write odd shapes", async () => {
  const desk = staff(t, "desk");
  await assertFails(
    desk.doc("referrals/n1").update({ status: "given", reward, givenOn: "2026-10-22" }),
  );
  await assertFails(desk.doc("referrals/n2").update({ referrerId: "r2" }));
  await assertFails(desk.doc("referrals/n2").delete());
  await assertFails(
    desk.doc("referrals/n8").set({ ...due, newClientId: "n8", status: "given", reward }),
  );
  await assertFails(desk.doc("referrals/n8").set({ ...due, newClientId: "other" }));
  await assertFails(desk.doc("referrals/n8").set({ ...due, newClientId: "n8", referrerId: "n8" }));
  await assertFails(desk.doc("referrals/n8").set({ ...due, newClientId: "n8", extra: 1 }));
});

test("Referral rewards decides, gives, reopens; the referrer is fixed once decided", async () => {
  const refs = staff(t, "refs");
  await assertSucceeds(
    refs
      .doc("referrals/n3")
      .update({
        status: "promised",
        reward: { ...reward, kind: "discount", days: 0, amount: 500 },
        decidedBy: "Refs",
        decidedAt: new Date(),
      }),
  );
  await assertSucceeds(refs.doc("referrals/n3").update({ status: "given", givenOn: "2026-10-22" }));
  await assertFails(refs.doc("referrals/n3").update({ referrerId: "r9" }));
  await assertFails(refs.doc("referrals/n3").update({ reward: { ...reward, kind: "cash" } }));
  await assertFails(
    refs.doc("referrals/n3").update({ reward: { ...reward, note: "x".repeat(201) } }),
  );
  await assertSucceeds(
    refs
      .doc("referrals/n3")
      .update({ status: "due", reward: null, decidedBy: "", decidedAt: null, givenOn: "" }),
  );
  await assertSucceeds(
    owner(t)
      .doc("referrals/n2")
      .update({ status: "skipped", reward: null, reason: "Left in a week" }),
  );
});

test("no Members and no Referral rewards, switched off or signed out: nothing", async () => {
  await assertFails(staff(t, "sett").doc("referrals/n1").get());
  await assertFails(staff(t, "sett").collection("referrals").get());
  await assertFails(staff(t, "off").doc("referrals/n1").get());
  await assertFails(nobody(t).doc("referrals/n1").get());
  await assertFails(
    nobody(t)
      .doc("referrals/n7")
      .set({ ...due, newClientId: "n7" }),
  );
});
