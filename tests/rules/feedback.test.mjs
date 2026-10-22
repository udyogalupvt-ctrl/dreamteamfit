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
const message = {
  clientId: "c1",
  clientName: "Ravi",
  memberCode: "101",
  phone: "9000000001",
  kind: "complaint",
  message: "The AC was off all evening",
  wantsCall: true,
  status: "new",
  reply: "",
  repliedBy: "",
  repliedAt: null,
  resolvedBy: "",
  resolvedAt: null,
  createdAt: new Date(),
};
const link = (url) => ({ googleReviewUrl: url, updatedAt: new Date(), updatedBy: "Owner" });

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "staffAccess/fb": { active: true, admin: false, permissions: ["feedback"] },
    "feedback/f1": message,
  });
});
after(() => t.cleanup());

test("a login with Member feedback reads, replies, resolves and reopens", async () => {
  const fb = staff(t, "fb");
  await assertSucceeds(fb.collection("feedback").where("status", "==", "new").get());
  await assertSucceeds(
    fb
      .doc("feedback/f1")
      .update({ reply: "Fixed today, sorry!", repliedBy: "Desk", repliedAt: new Date() }),
  );
  await assertSucceeds(
    fb
      .doc("feedback/f1")
      .update({ status: "resolved", resolvedBy: "Desk", resolvedAt: new Date() }),
  );
  await assertSucceeds(
    owner(t).doc("feedback/f1").update({ status: "new", resolvedBy: "", resolvedAt: null }),
  );
});

test("what the member wrote never changes; nobody adds or deletes from the desk", async () => {
  const fb = staff(t, "fb");
  await assertFails(fb.doc("feedback/f1").update({ message: "edited" }));
  await assertFails(fb.doc("feedback/f1").update({ clientId: "c2" }));
  await assertFails(fb.doc("feedback/f1").update({ status: "spam" }));
  await assertFails(fb.doc("feedback/f1").update({ reply: "x".repeat(1001) }));
  await assertFails(fb.doc("feedback/f2").set(message));
  await assertFails(owner(t).doc("feedback/f2").set(message));
  await assertFails(owner(t).doc("feedback/f1").delete());
});

test("logins without Member feedback (even with Members), switched off or none see nothing", async () => {
  await assertFails(staff(t, "desk").doc("feedback/f1").get());
  await assertFails(staff(t, "desk").doc("feedback/f1").update({ status: "resolved" }));
  await assertFails(staff(t, "off").doc("feedback/f1").get());
  await assertFails(nobody(t).doc("feedback/f1").get());
});

test("the review link: Settings logins save an https link or clear it, nothing else", async () => {
  const sett = staff(t, "sett");
  await assertSucceeds(sett.doc("settings/memberApp").set(link("https://g.page/r/abc/review")));
  await assertSucceeds(sett.doc("settings/memberApp").set(link("")));
  await assertFails(sett.doc("settings/memberApp").set(link("http://g.page/r/abc/review")));
  await assertFails(sett.doc("settings/memberApp").set(link("javascript:alert(1)")));
  await assertFails(sett.doc("settings/memberApp").set(link(`https://g.page/${"x".repeat(500)}`)));
  await assertFails(sett.doc("settings/memberApp").set({ ...link(""), extra: 1 }));
  await assertFails(staff(t, "desk").doc("settings/memberApp").set(link("https://g.page/r/x")));
  await assertSucceeds(staff(t, "desk").doc("settings/memberApp").get());
});
