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
const entry = (id, over = {}) => ({
  id,
  date: "2026-10-20",
  weightKg: 72.5,
  bodyFatPct: 0,
  measurements: { chest: 0, waist: 0, hips: 0, arm: 0, thigh: 0 },
  photos: [],
  note: "",
  by: { kind: "member", id: "c1", name: "Ravi" },
  at: 1,
  ...over,
});
const doc = (clientId, entries) => ({ clientId, entries, updatedAt: new Date() });

before(async () => {
  t = await env();
  await seed(t, { ...LOGINS, "bodyProgress/c1": doc("c1", [entry("a")]) });
});
after(() => t.cleanup());

test("the desk reads, adds and edits a member's entries", async () => {
  const desk = staff(t, "desk");
  await assertSucceeds(desk.doc("bodyProgress/c1").get());
  await assertSucceeds(desk.doc("bodyProgress/c1").set(doc("c1", [entry("a"), entry("b")])));
  await assertSucceeds(desk.doc("bodyProgress/c2").set(doc("c2", [entry("x")])));
  await assertSucceeds(
    owner(t)
      .doc("bodyProgress/c1")
      .update({ entries: [entry("a")] }),
  );
});

test("the doc stays the right shape: its own member, no extra fields, at most 400 entries", async () => {
  const desk = staff(t, "desk");
  await assertFails(desk.doc("bodyProgress/c1").set(doc("c2", [])));
  await assertFails(desk.doc("bodyProgress/c1").set({ ...doc("c1", []), extra: 1 }));
  await assertFails(desk.doc("bodyProgress/c1").set({ clientId: "c1", entries: "x" }));
  const many = Array.from({ length: 401 }, (_, i) => ({ id: `e${i}` }));
  await assertFails(desk.doc("bodyProgress/c1").set(doc("c1", many)));
  await assertFails(owner(t).doc("bodyProgress/c1").delete());
});

test("a login without Members, a switched-off login or no login sees nothing", async () => {
  await assertFails(staff(t, "sett").doc("bodyProgress/c1").get());
  await assertFails(staff(t, "sett").doc("bodyProgress/c1").set(doc("c1", [])));
  await assertFails(staff(t, "off").doc("bodyProgress/c1").get());
  await assertFails(nobody(t).doc("bodyProgress/c1").get());
  await assertFails(nobody(t).doc("bodyProgress/c9").set(doc("c9", [])));
});
