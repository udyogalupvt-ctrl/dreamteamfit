import { after, before, test } from "node:test";
import { env, seed, LOGINS, owner, staff, nobody, assertFails, assertSucceeds } from "./helpers.mjs";

let t;
before(async () => {
  t = await env();
  await seed(t, { ...LOGINS, "settings/business": { name: "Gym" } });
});
after(() => t.cleanup());

test("owner and an active staff login read settings", async () => {
  await assertSucceeds(owner(t).doc("settings/business").get());
  await assertSucceeds(staff(t, "desk").doc("settings/business").get());
});

test("a switched-off login, an unknown account and no login are refused", async () => {
  await assertFails(staff(t, "off").doc("settings/business").get());
  await assertFails(staff(t, "stranger").doc("settings/business").get());
  await assertFails(nobody(t).doc("settings/business").get());
});
