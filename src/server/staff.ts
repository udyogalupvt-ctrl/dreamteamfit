/**
 * Staff logins, created and changed only by an owner (OWNER_EMAILS):
 *   POST /api/staff/create-login  { staffId, email, password, admin, permissions }
 *   POST /api/staff/update-login  { staffId, admin?, permissions?, active?, password? }
 * The login's features live in /staffAccess/{uid}; Firestore rules read them.
 */
import { FieldValue } from "firebase-admin/firestore";
import { isOwnerEmail } from "@/constants/owners";
import { STAFF_FEATURES, type StaffFeature } from "@/types/models";
import { adminAuth, db, json, requireStaff } from "./admin";

const cleanFeatures = (x: unknown): StaffFeature[] =>
  Array.isArray(x)
    ? x.filter((f): f is StaffFeature => (STAFF_FEATURES as readonly string[]).includes(String(f)))
    : [];

async function logLine(ownerEmail: string, staffId: string, summary: string) {
  await db().collection("auditLogs").add({
    at: FieldValue.serverTimestamp(),
    collection: "staffAccess",
    docId: staffId,
    action: "updated",
    summary,
    clientId: "",
    clientName: "",
    actorType: "app_user",
    actorUid: "",
    actorName: ownerEmail,
    changes: {},
  });
}

const authError = (e: unknown) => {
  const code = String((e as { code?: string }).code ?? "");
  if (code.includes("email-already-exists"))
    return "This email already has a login. Use another email.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("invalid-password")) return "Password must be at least 6 characters.";
  return "Couldn't save the login. Try again.";
};

async function createLogin(body: Record<string, unknown>, ownerEmail: string) {
  const staffId = String(body["staffId"] ?? "");
  const email = String(body["email"] ?? "")
    .trim()
    .toLowerCase();
  const password = String(body["password"] ?? "");
  if (!staffId || !email) return json({ error: "Staff and email are required." }, 400);
  if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);
  if (isOwnerEmail(email)) return json({ error: "That is an owner email." }, 400);
  const staffRef = db().doc(`staff/${staffId}`);
  const staff = await staffRef.get();
  if (!staff.exists) return json({ error: "Staff member not found." }, 404);
  if (staff.data()?.["loginUid"])
    return json({ error: "This staff member already has a login." }, 409);
  let uid: string;
  try {
    uid = (
      await adminAuth().createUser({
        email,
        password,
        displayName: String(staff.data()?.["name"] ?? ""),
      })
    ).uid;
  } catch (e) {
    return json({ error: authError(e) }, 400);
  }
  const admin = body["admin"] === true;
  const batch = db().batch();
  batch.set(db().doc(`staffAccess/${uid}`), {
    staffId,
    name: String(staff.data()?.["name"] ?? ""),
    email,
    active: true,
    admin,
    permissions: cleanFeatures(body["permissions"]),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(staffRef, {
    loginUid: uid,
    loginEmail: email,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  await logLine(
    ownerEmail,
    staffId,
    `Login created for ${String(staff.data()?.["name"] ?? "")} (${email})`,
  );
  return json({ uid });
}

async function updateLogin(body: Record<string, unknown>, ownerEmail: string) {
  const staffId = String(body["staffId"] ?? "");
  const staff = await db().doc(`staff/${staffId}`).get();
  const uid = String(staff.data()?.["loginUid"] ?? "");
  if (!staff.exists || !uid) return json({ error: "This staff member has no login." }, 404);
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  const changes: string[] = [];
  if (body["permissions"] !== undefined) {
    patch["permissions"] = cleanFeatures(body["permissions"]);
    changes.push("features");
  }
  if (typeof body["admin"] === "boolean") {
    patch["admin"] = body["admin"];
    changes.push(body["admin"] ? "all features on" : "all features off");
  }
  const authPatch: { disabled?: boolean; password?: string } = {};
  if (typeof body["active"] === "boolean") {
    patch["active"] = body["active"];
    authPatch.disabled = !body["active"];
    changes.push(body["active"] ? "login switched on" : "login switched off");
  }
  if (typeof body["password"] === "string" && body["password"]) {
    if (body["password"].length < 6)
      return json({ error: "Password must be at least 6 characters." }, 400);
    authPatch.password = body["password"];
    changes.push("password changed");
  }
  try {
    if (Object.keys(authPatch).length) await adminAuth().updateUser(uid, authPatch);
    if (authPatch.disabled) await adminAuth().revokeRefreshTokens(uid);
  } catch (e) {
    return json({ error: authError(e) }, 400);
  }
  await db().doc(`staffAccess/${uid}`).set(patch, { merge: true });
  if (changes.length)
    await logLine(
      ownerEmail,
      staffId,
      `Login of ${String(staff.data()?.["name"] ?? "")}: ${changes.join(", ")}`,
    );
  return json({ ok: true });
}

export async function handleStaff(request: Request, url: URL) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = await requireStaff(request);
  if (!user) return json({ error: "Sign in required." }, 401);
  if (!isOwnerEmail(user.email))
    return json({ error: "Only the owner can manage staff logins." }, 403);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = url.pathname.replace(/^\/api\/staff\/?/, "").replace(/\/+$/, "");
  if (action === "create-login") return createLogin(body, user.email ?? "owner");
  if (action === "update-login") return updateLogin(body, user.email ?? "owner");
  return json({ error: "Not found" }, 404);
}
