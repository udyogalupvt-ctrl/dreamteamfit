import { after, before, test } from "node:test";
import { env, seed, LOGINS, owner, staff, nobody, assertFails, assertSucceeds } from "./helpers.mjs";

let t;
const form = { enabled: true, version: 2, requiredVersion: 1, title: "Health form", questions: [] };
const paper = (over = {}) => ({
  clientId: "c1",
  clientName: "Ravi",
  version: 2,
  title: "Health form",
  answers: [],
  consent: "",
  signedName: "",
  method: "paper",
  by: "Desk",
  note: "",
  signedOn: "2026-10-22",
  ...over,
});

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "settings/healthForm": form,
    "healthForms/app1": paper({ method: "app", answers: [{ id: "q1", answer: "no" }] }),
    "healthForms/paper1": paper(),
  });
});
after(() => t.cleanup());

test("only the owner edits the health form; staff read it", async () => {
  await assertSucceeds(owner(t).doc("settings/healthForm").set({ ...form, version: 3 }));
  await assertFails(staff(t, "sett").doc("settings/healthForm").set({ ...form, version: 4 }));
  await assertFails(staff(t, "all").doc("settings/healthForm").update({ requiredVersion: 3 }));
  await assertSucceeds(staff(t, "desk").doc("settings/healthForm").get());
  // The rest of Settings is unchanged: a "Settings" login still saves the business details.
  await assertSucceeds(staff(t, "sett").doc("settings/business").set({ businessName: "Gym" }));
});

test("the desk records a paper form and can take it back", async () => {
  const desk = staff(t, "desk");
  await assertSucceeds(desk.doc("healthForms/p2").set(paper({ note: "Knee pain" })));
  await assertSucceeds(desk.doc("healthForms/p2").get());
  await assertSucceeds(desk.doc("healthForms/p2").delete());
});

test("nobody writes an app acceptance from a browser or edits one", async () => {
  const desk = staff(t, "desk");
  await assertFails(desk.doc("healthForms/fake").set(paper({ method: "app" })));
  await assertFails(desk.doc("healthForms/fake").set(paper({ answers: [{ id: "q1", answer: "no" }] })));
  await assertFails(desk.doc("healthForms/fake").set(paper({ extra: true })));
  await assertFails(desk.doc("healthForms/paper1").update({ note: "changed" }));
  await assertFails(owner(t).doc("healthForms/app1").update({ signedName: "x" }));
  await assertFails(desk.doc("healthForms/app1").delete());
});

test("a login without Members, or no login, sees no health forms", async () => {
  await assertFails(staff(t, "sett").doc("healthForms/paper1").get());
  await assertFails(staff(t, "off").doc("healthForms/paper1").get());
  await assertFails(nobody(t).doc("healthForms/paper1").get());
  await assertFails(nobody(t).doc("settings/healthForm").get());
});
