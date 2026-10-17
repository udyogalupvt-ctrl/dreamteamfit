// S5: only a login that may delete a record may put a copy of it in the Recycle Bin (a restore
// writes the copy back with the restorer's rights, often the owner's).
import { after, before, test } from "node:test";
import { env, seed, LOGINS, staff, owner, assertFails, assertSucceeds } from "./helpers.mjs";

let t;
before(async () => {
  t = await env();
  await seed(t, LOGINS);
});
after(() => t.cleanup());

const item = (uid, collection, extra = {}) => ({
  binId: "b1",
  n: 0,
  path: `${collection}/x1`,
  collection,
  docId: "x1",
  data: { name: "copy" },
  deletedByUid: uid,
  createdAt: new Date(),
  ...extra,
});
const entry = (uid, section) => ({
  section,
  label: "Thing",
  detail: "",
  count: 1,
  deletedBy: uid,
  deletedByUid: uid,
  deletedByRole: "staff",
  deletedAt: new Date(),
  extra: {},
});
const putItem = (uid, collection, db = staff(t, uid)) =>
  db.collection("recycleBinItems").doc().set(item(uid, collection));
const putEntry = (uid, section, db = staff(t, uid)) =>
  db.collection("recycleBin").doc().set(entry(uid, section));

test("staff and staff pay copies: owner only", async () => {
  await assertFails(putItem("desk", "staff"));
  await assertFails(putItem("desk", "staffPrivate"));
  await assertFails(putItem("all", "staff"));
  await assertSucceeds(putItem("owner", "staff", owner(t)));
  await assertSucceeds(putItem("owner", "staffPrivate", owner(t)));
});

test("money copies need a delete right or Finance", async () => {
  for (const c of ["payments", "invoices", "publicInvoices", "trainerPayouts"]) {
    await assertFails(putItem("desk", c));
    await assertSucceeds(putItem("bills", c));
    await assertSucceeds(putItem("delmem", c));
    await assertSucceeds(putItem("plans", c));
  }
  await assertSucceeds(putItem("fin", "payments"));
});

test("plan copies need Delete plans or Delete members", async () => {
  for (const c of ["memberships", "ptAssignments", "enrollments"]) {
    await assertFails(putItem("desk", c));
    await assertFails(putItem("bills", c));
    await assertSucceeds(putItem("plans", c));
    await assertSucceeds(putItem("delmem", c));
  }
});

test("members need Delete members; machine commands are never binned", async () => {
  await assertFails(putItem("desk", "clients"));
  await assertFails(putItem("plans", "clients"));
  await assertSucceeds(putItem("delmem", "clients"));
  await assertFails(putItem("delmem", "biometricCommands"));
  await assertFails(putItem("owner", "biometricCommands", owner(t)));
});

test("trainers and packages need Delete packages (or the owner)", async () => {
  await assertFails(putItem("desk", "trainers"));
  await assertFails(putItem("desk", "packages"));
  await seed(t, {
    "staffAccess/pk": { active: true, admin: false, permissions: ["deletePackages"] },
  });
  await assertSucceeds(putItem("pk", "trainers"));
  await assertSucceeds(putItem("pk", "packages"));
  await assertSucceeds(putItem("owner", "trainers", owner(t)));
});

test("everyday records stay open to every staff login", async () => {
  for (const c of ["inquiries", "followups", "leadLogs", "attendance", "whatsappMessages"])
    await assertSucceeds(putItem("desk", c));
});

test("an item is still filed under its own login and a real path", async () => {
  const desk = staff(t, "desk");
  await assertFails(desk.collection("recycleBinItems").doc().set(item("other", "inquiries")));
  await assertFails(
    desk.collection("recycleBinItems").doc().set(item("desk", "inquiries", { path: "staffAccess/x1" })),
  );
  await assertFails(
    desk.collection("recycleBinItems").doc().set(item("desk", "staffAccess", { path: "staffAccess/x1" })),
  );
});

test("bin entries need that section's delete right", async () => {
  await assertFails(putEntry("desk", "staff"));
  await assertSucceeds(putEntry("owner", "staff", owner(t)));
  await assertFails(putEntry("desk", "bills"));
  await assertSucceeds(putEntry("bills", "bills"));
  await assertSucceeds(putEntry("fin", "bills")); // Remove payment files under "bills"
  await assertFails(putEntry("desk", "members"));
  await assertSucceeds(putEntry("delmem", "members"));
  await assertFails(putEntry("desk", "plans"));
  await assertSucceeds(putEntry("plans", "plans"));
  await assertFails(putEntry("desk", "packages"));
  await assertFails(putEntry("desk", "expenses"));
  await assertFails(putEntry("desk", "leads"));
  await seed(t, {
    "staffAccess/lead": { active: true, admin: false, permissions: ["deleteLeads"] },
    "staffAccess/exp": { active: true, admin: false, permissions: ["deleteExpenses"] },
  });
  await assertSucceeds(putEntry("lead", "leads"));
  await assertSucceeds(putEntry("exp", "expenses"));
  await assertFails(staff(t, "desk").collection("recycleBin").doc().set(entry("other", "leads")));
});
