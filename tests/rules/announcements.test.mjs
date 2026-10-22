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
const post = {
  channel: "app",
  message: "Closed on Sunday",
  groups: ["active"],
  typedNumbers: 0,
  recipients: [],
  skipped: 0,
  total: 2,
  sent: 0,
  failed: 0,
  status: "done",
  appClientIds: ["c1", "c2"],
  pushed: null,
  removedClientIds: [],
  removedAt: null,
  removedByName: "",
  editedAt: null,
  editedByName: "",
  createdAt: new Date(),
  createdBy: "ann",
  createdByName: "Desk",
};

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "staffAccess/ann": { active: true, admin: false, permissions: ["announcements"] },
    "announcements/a1": post,
    "announcements/p1": { ...post, pushed: { sent: 2 }, pushedAt: new Date() },
  });
});
after(() => t.cleanup());

test("a login with Announcements posts, edits, removes from the app and shows it again", async () => {
  const ann = staff(t, "ann");
  await assertSucceeds(ann.doc("announcements/a2").set(post));
  await assertSucceeds(ann.collection("announcements").get());
  await assertSucceeds(
    ann
      .doc("announcements/a1")
      .update({ message: "Closed Sunday and Monday", editedAt: new Date() }),
  );
  await assertSucceeds(
    ann.doc("announcements/a1").update({ appClientIds: [], removedClientIds: ["c1", "c2"] }),
  );
  await assertSucceeds(
    owner(t)
      .doc("announcements/a1")
      .update({ appClientIds: ["c1", "c2"], removedClientIds: [] }),
  );
});

test("logins without Announcements (even with Members), switched off or none see nothing", async () => {
  await assertFails(staff(t, "desk").doc("announcements/a1").get());
  await assertFails(staff(t, "desk").collection("announcements").get());
  await assertFails(staff(t, "desk").doc("announcements/a3").set(post));
  await assertFails(staff(t, "sett").doc("announcements/a1").update({ appClientIds: [] }));
  await assertFails(staff(t, "off").doc("announcements/a1").get());
  await assertFails(nobody(t).doc("announcements/a1").get());
  await assertFails(
    nobody(t).collection("announcements").where("appClientIds", "array-contains", "c1").get(),
  );
});

test("nobody rewrites when or whether an app post was pushed", async () => {
  const ann = staff(t, "ann");
  await assertFails(ann.doc("announcements/p1").update({ pushedAt: null }));
  await assertFails(owner(t).doc("announcements/p1").update({ pushed: null }));
  await assertSucceeds(ann.doc("announcements/p1").update({ message: "Edited", editedAt: new Date() }));
});
