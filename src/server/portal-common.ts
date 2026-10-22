/**
 * Shared by the member-app / trainer-app endpoints that live outside portal.ts (health form,
 * progress, feedback, referrals): the signed-in member's record and the activity-log line.
 */
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { db, json } from "./admin";

export const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const n = (v: unknown) => Number(v ?? 0) || 0;

/** Reads the body of a POST as an object ({} when it isn't JSON). */
export const bodyOf = async (request: Request) => {
  const b: unknown = await request.json().catch(() => ({}));
  // `null`, a list or a bare value is no body (it would crash `body["x"]`).
  return (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
};

/** The member's record, or the error response when it is gone or their app is switched off. */
export async function liveMember(
  clientId: string,
): Promise<{ ok: true; data: DocumentData } | { ok: false; response: Response }> {
  const data = (await db().doc(`clients/${clientId}`).get()).data();
  if (!data)
    return { ok: false, response: json({ error: "This member account no longer exists." }, 404) };
  if (data["portalActive"] === false)
    return {
      ok: false,
      response: json({ error: "Your member app is switched off. Please contact the gym." }, 403),
    };
  return { ok: true, data };
}

/** Activity-log line for something a member or trainer did in their app. */
export async function appLog(entry: {
  collection: string;
  docId: string;
  summary: string;
  actorName: string;
  action?: "created" | "updated" | "deleted";
  clientId?: string;
  clientName?: string;
}) {
  await db()
    .collection("auditLogs")
    .add({
      at: FieldValue.serverTimestamp(),
      action: entry.action ?? "updated",
      clientId: entry.clientId ?? "",
      clientName: entry.clientName ?? "",
      collection: entry.collection,
      docId: entry.docId,
      summary: entry.summary,
      actorType: "app_user",
      actorUid: "",
      actorName: entry.actorName,
      changes: {},
    })
    .catch((e) => console.error("audit write failed", String(e)));
}

/** Only images from this gym's Cloudinary account are accepted. */
export function isOurImage(url: string) {
  const cloud = (process.env["VITE_CLOUDINARY_CLOUD_NAME"] ?? "").trim();
  const prefix = cloud
    ? `https://res.cloudinary.com/${cloud}/image/upload/`
    : "https://res.cloudinary.com/";
  return url.startsWith(prefix) && url.length < 500 && !/[\s"'<>]/.test(url);
}
