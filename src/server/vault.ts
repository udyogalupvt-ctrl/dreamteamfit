/**
 * Password safe for staff and trainer logins, so the owner can see a forgotten password and
 * send it again. Firebase keeps only a hash of each password; this keeps a second copy that is
 * encrypted (AES-256-GCM) with a key that exists only on the server:
 *   LOGIN_VAULT_KEY (any long random text) when set, otherwise one derived from the Firebase
 *   service-account private key (already a server secret).
 * The copies live in /loginVault, which Firestore rules close to everyone; only the owner's
 * "Show password" (src/server/portal.ts) opens one, and every opening is written to the log.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { credentials, db } from "./admin";

type KeyId = "env" | "sa" | "emu";

function key(id: KeyId): Buffer | null {
  let secret = "";
  if (id === "env") secret = (process.env["LOGIN_VAULT_KEY"] ?? "").trim();
  else if (id === "sa") {
    try {
      secret = credentials().privateKey;
    } catch {
      secret = "";
    }
  } else if (process.env["FIRESTORE_EMULATOR_HOST"]) secret = "local-emulator-only";
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "rebuild-fitness", "login-vault-v1", 32));
}

/** The key new copies are locked with. */
function currentKey(): { id: KeyId; key: Buffer } {
  for (const id of ["env", "sa", "emu"] as const) {
    const k = key(id);
    if (k) return { id, key: k };
  }
  throw new Error("No server key for the password safe (FIREBASE_SERVICE_ACCOUNT).");
}

export type VaultKind = "staff" | "trainer";
const ref = (kind: VaultKind, id: string) => db().doc(`loginVault/${kind}_${id}`);

export async function savePassword(kind: VaultKind, id: string, password: string) {
  const { id: k, key: secret } = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  await ref(kind, id).set({
    k,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** The saved password, or "" when none was saved (set before the safe existed) or unreadable. */
export async function readPassword(kind: VaultKind, id: string) {
  const snap = await ref(kind, id).get();
  const d = snap.data();
  if (!d) return "";
  const secret = key(String(d["k"]) as KeyId);
  if (!secret) return "";
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      Buffer.from(String(d["iv"]), "base64"),
    );
    decipher.setAuthTag(Buffer.from(String(d["tag"]), "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(String(d["data"]), "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Key changed (e.g. a new service-account key): set a new password to save it again.
    return "";
  }
}

export const hasSavedPassword = async (kind: VaultKind, id: string) =>
  (await ref(kind, id).get()).exists;
