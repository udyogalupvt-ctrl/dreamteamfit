/**
 * Member photo upload link (no login): /photo/<token> in the app.
 *   GET  /api/member-photo?token=…   → { firstName, gymName } so the page can greet them
 *   POST /api/member-photo { token, url } → saves the photo (a Cloudinary image) on the member
 * The token is random and single-use: it is cleared once the photo is saved.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db, json } from "./admin";
import { systemAudit } from "./audit";

async function memberFor(token: string) {
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return null;
  const snap = await db()
    .collection("clients")
    .where("photoUploadToken", "==", token)
    .limit(1)
    .get();
  return snap.docs[0] ?? null;
}

/** Only images from this gym's Cloudinary account are accepted. */
function isOurImage(url: string) {
  const cloud = (process.env["VITE_CLOUDINARY_CLOUD_NAME"] ?? "").trim();
  const prefix = cloud
    ? `https://res.cloudinary.com/${cloud}/image/upload/`
    : "https://res.cloudinary.com/";
  return url.startsWith(prefix) && url.length < 500 && !/[\s"'<>]/.test(url);
}

export async function handleMemberPhoto(request: Request, url: URL) {
  if (request.method === "GET") {
    const member = await memberFor(url.searchParams.get("token") ?? "");
    if (!member) return json({ error: "This link is not valid any more." }, 404);
    const gym = await db().doc("settings/business").get();
    return json({
      firstName: String(member.data()["fullName"] ?? "").split(" ")[0] || "there",
      gymName: String(gym.data()?.["businessName"] ?? "our gym"),
      logoUrl: String(gym.data()?.["logoUrl"] ?? ""),
    });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await request.json().catch(() => ({}))) as { token?: string; url?: string };
  const member = await memberFor(String(body.token ?? ""));
  if (!member) return json({ error: "This link is not valid any more." }, 404);
  const photo = String(body.url ?? "");
  if (!isOurImage(photo)) return json({ error: "Upload the photo again." }, 400);
  await member.ref.update({
    profilePhotoUrl: photo,
    photoUploadToken: FieldValue.delete(),
    photoUploadedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await systemAudit({
    collection: "clients",
    docId: member.id,
    clientId: member.id,
    clientName: String(member.data()["fullName"] ?? ""),
    summary: "Member uploaded their photo from the link",
  });
  return json({ ok: true });
}
