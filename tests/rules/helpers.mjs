// Firestore rules tests: run with `npm run test:rules` (emulator on port 8780, see
// firebase.rules-test.json). Every file starts from an empty database and seeds what it needs
// with the rules switched off.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";

export { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";

export const OWNER = "rebuildfitnesskkd@gmail.com";

export async function env() {
  const t = await initializeTestEnvironment({
    projectId: "demo-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8780 },
  });
  await t.clearFirestore();
  return t;
}

// India day as YYYY-MM-DD, n days from today (same clock as the rules' istNow()).
export const day = (n = 0) =>
  new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
// The Day Book is open from the 1st of last month (cashOpenFrom in finance.service.ts).
export const firstOfLastMonth = () => {
  const [y, m] = day().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};
// The last closed day: the day before the lock.
export const closedDay = () => {
  const d = new Date(firstOfLastMonth() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
// A timestamp n days from now (createdAt of a payment "typed" that day).
export const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

// Logins. Staff features live in staffAccess/{uid} (seeded with rules off).
export const owner = (t) =>
  t.authenticatedContext("owner", { email: OWNER, email_verified: true }).firestore();
export const staff = (t, uid) => t.authenticatedContext(uid, { email: `${uid}@x.test` }).firestore();
export const nobody = (t) => t.unauthenticatedContext().firestore();

export async function seed(t, docs) {
  await t.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const [path, data] of Object.entries(docs)) await db.doc(path).set(data);
  });
}

export const LOGINS = {
  "staffAccess/desk": { active: true, admin: false, permissions: ["members", "billing", "daybook"] },
  "staffAccess/desk2": { active: true, admin: false, permissions: ["members", "billing", "daybook"] },
  "staffAccess/fin": { active: true, admin: false, permissions: ["members", "billing", "finance"] },
  "staffAccess/bills": { active: true, admin: false, permissions: ["members", "deleteBills"] },
  "staffAccess/delmem": { active: true, admin: false, permissions: ["members", "deleteMembers"] },
  "staffAccess/plans": { active: true, admin: false, permissions: ["members", "deletePlans"] },
  "staffAccess/sett": { active: true, admin: false, permissions: ["settings"] },
  "staffAccess/dev": { active: true, admin: false, permissions: ["devices"] },
  "staffAccess/bin": { active: true, admin: false, permissions: ["recycleBin"] },
  "staffAccess/all": { active: true, admin: true, permissions: [] },
  "staffAccess/off": { active: false, admin: true, permissions: [] },
};
