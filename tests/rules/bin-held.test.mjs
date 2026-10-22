// A member's held records (health forms, body progress, feedback, referral rewards) go to the
// Recycle Bin with their member and come back only through their bin copy
// (src/services/recycle-bin.service.ts HELD).
import { after, before, test } from "node:test";
import { env, seed, LOGINS, staff, owner, assertFails, assertSucceeds } from "./helpers.mjs";

let t;
before(async () => {
  t = await env();
  await seed(t, LOGINS);
});
after(() => t.cleanup());

const RECORDS = {
  healthForms: () => ({
    clientId: "m1",
    clientName: "Ravi",
    version: 1,
    title: "Health form",
    answers: [{ q: "Heart trouble?", answer: "yes", detail: "BP" }],
    consent: "I agree",
    signedName: "Ravi",
    method: "app",
    by: "",
    note: "",
    signedOn: "2026-10-20",
    createdAt: new Date("2026-10-20T05:00:00Z"),
    updatedAt: new Date("2026-10-20T05:00:00Z"),
  }),
  bodyProgress: (id) => ({
    clientId: id,
    entries: [{ id: "e1", date: "2026-10-01", weightKg: 72.5, at: 1 }],
    updatedAt: new Date("2026-10-01T05:00:00Z"),
  }),
  feedback: () => ({ clientId: "m1", text: "AC is weak", status: "new", reply: "" }),
  referrals: (id) => ({
    referrerId: "m1",
    referrerName: "Ravi",
    referrerCode: "101",
    newClientId: id,
    newClientName: "Sita",
    newClientCode: "102",
    joinedOn: "2026-10-01",
    status: "given",
    reward: { kind: "free_days", days: 7, amount: 0, note: "" },
    reason: "",
    decidedBy: "Owner",
    decidedAt: new Date("2026-10-02T05:00:00Z"),
    givenOn: "2026-10-02",
    createdAt: new Date("2026-10-01T05:00:00Z"),
    updatedAt: new Date("2026-10-02T05:00:00Z"),
  }),
};
const rec = (c, id) => RECORDS[c](id);
const copyId = (c, id) => `${c}_${id}`;
const copy = (uid, c, id, data = rec(c, id), extra = {}) => ({
  binId: "b1",
  n: 1,
  path: `${c}/${id}`,
  collection: c,
  docId: id,
  data,
  deletedByUid: uid,
  createdAt: new Date(),
  ...extra,
});
const putCopy = (db, uid, c, id, data, docId = copyId(c, id)) =>
  db.collection("recycleBinItems").doc(docId).set(copy(uid, c, id, data));
const seedCopy = (uid, c, id) => seed(t, { [`recycleBinItems/${copyId(c, id)}`]: copy(uid, c, id) });

test("a held copy: Delete members only, at its fixed id, exactly the record", async () => {
  for (const c of Object.keys(RECORDS)) {
    const id = `${c}-1`;
    await seed(t, { [`${c}/${id}`]: rec(c, id) });
    const delmem = staff(t, "delmem");
    await assertFails(putCopy(staff(t, "desk"), "desk", c, id));
    await assertFails(putCopy(delmem, "delmem", c, id, undefined, "random1"));
    await assertFails(putCopy(delmem, "delmem", c, id, { ...rec(c, id), forged: true }));
    await assertFails(putCopy(delmem, "delmem", c, `${c}-none`));
    await assertSucceeds(putCopy(delmem, "delmem", c, id));
  }
});

test("a held record leaves only with its copy, filed by this login", async () => {
  for (const c of Object.keys(RECORDS)) {
    const id = `${c}-2`;
    await seed(t, { [`${c}/${id}`]: rec(c, id) });
    const ref = (db) => db.collection(c).doc(id);
    // No copy: an app health form, body progress, feedback, a given reward can't be deleted.
    await assertFails(ref(staff(t, "delmem")).delete());
    await assertFails(ref(owner(t)).delete());
    await seedCopy("delmem", c, id);
    await assertFails(ref(staff(t, "desk")).delete());
    await assertFails(ref(staff(t, "all")).delete()); // copy filed by someone else
    await assertSucceeds(ref(staff(t, "delmem")).delete());
  }
});

test("a held record comes back only as its copy, which leaves the bin in the same go", async () => {
  for (const c of Object.keys(RECORDS)) {
    const id = `${c}-3`;
    await seedCopy("delmem", c, id);
    const back = (db, data = rec(c, id), dropCopy = true) => {
      const b = db.batch();
      b.set(db.collection(c).doc(id), data);
      if (dropCopy) b.delete(db.collection("recycleBinItems").doc(copyId(c, id)));
      return b.commit();
    };
    // (The desk writes body progress by hand anyway.)
    if (c !== "bodyProgress") await assertFails(back(owner(t), rec(c, id), false));
    await assertFails(back(owner(t), { ...rec(c, id), forged: true }));
    await assertFails(back(staff(t, "desk")));
    await assertSucceeds(back(staff(t, "delmem")));
  }
  // A Recycle Bin login restores what someone else deleted.
  const id = "feedback-4";
  await seedCopy("delmem", "feedback", id);
  const bin = staff(t, "bin");
  const b = bin.batch();
  b.set(bin.collection("feedback").doc(id), rec("feedback", id));
  b.delete(bin.collection("recycleBinItems").doc(copyId("feedback", id)));
  await assertSucceeds(b.commit());
});

test("no copy, no forging: app health forms and feedback still can't be written by hand", async () => {
  await assertFails(staff(t, "all").collection("healthForms").doc("hf-x").set(rec("healthForms", "hf-x")));
  await assertFails(staff(t, "all").collection("feedback").doc("fb-x").set(rec("feedback", "fb-x")));
  await assertFails(owner(t).collection("referrals").doc("r-x").set(rec("referrals", "r-x")));
});

test("Delete members reads feedback (it goes with the member)", async () => {
  await seed(t, { "feedback/fb-r": rec("feedback", "fb-r") });
  await assertSucceeds(staff(t, "delmem").collection("feedback").where("clientId", "==", "m1").get());
  await assertFails(staff(t, "desk").collection("feedback").where("clientId", "==", "m1").get());
});

test("an older copy of a record that came back some other way is replaced", async () => {
  const id = "referrals-5";
  await seedCopy("all", "referrals", id); // binned earlier with its referrer
  await seed(t, { [`referrals/${id}`]: { ...rec("referrals", id), referrerId: "m9", status: "due" } });
  const now = { ...rec("referrals", id), referrerId: "m9", status: "due" };
  await assertFails(putCopy(staff(t, "desk"), "desk", "referrals", id, now));
  await assertFails(putCopy(staff(t, "delmem"), "delmem", "referrals", id, rec("referrals", id)));
  await assertSucceeds(putCopy(staff(t, "delmem"), "delmem", "referrals", id, now));
});

test("a member restored from the bin keeps their health form summary", async () => {
  const back = (db) =>
    db.collection("clients").doc("m-back").set({ fullName: "Ravi", healthForm: { version: 1, method: "app" } });
  await assertFails(back(staff(t, "desk")));
  await assertSucceeds(back(staff(t, "delmem")));
  await assertSucceeds(back(staff(t, "bin")));
});

test("eight held records go in one batch (rules lookups stay under the limit)", async () => {
  const ids = Array.from({ length: 8 }, (_, k) => `fb-many-${k}`);
  await seed(t, Object.fromEntries(ids.map((id) => [`feedback/${id}`, rec("feedback", id)])));
  const db = staff(t, "delmem");
  const copies = db.batch();
  ids.forEach((id) =>
    copies.set(db.collection("recycleBinItems").doc(copyId("feedback", id)), copy("delmem", "feedback", id)),
  );
  await assertSucceeds(copies.commit());
  const gone = db.batch();
  ids.forEach((id) => gone.delete(db.collection("feedback").doc(id)));
  await assertSucceeds(gone.commit());
  const back = db.batch();
  ids.forEach((id) => {
    back.set(db.collection("feedback").doc(id), rec("feedback", id));
    back.delete(db.collection("recycleBinItems").doc(copyId("feedback", id)));
  });
  await assertSucceeds(back.commit());
});
