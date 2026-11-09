/**
 * Anonymous feedback from the QR posters (src/lib/anon-feedback.ts). No login.
 *
 *   GET  /api/feedback/<token>   { on, gymName, logoUrl, place }  (place = the link's name)
 *   POST /api/feedback/<token>   { kind, rating, message, device, website }  → { ok }
 *
 * Nothing that points to the sender is saved with a message: no name, phone, device, network or
 * exact time (only the hour), and no Activity-log line (its exact time would give them away).
 * Spam limits use counters keyed on a keyed hash of (day, network, the page's random device id),
 * kept apart from the messages; a new day gives new keys, so days can't be linked either.
 */
import { createHmac } from "node:crypto";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  ANON_LIMITS,
  cleanAnonFeedback,
  isFeedbackToken,
  nextDayCount,
  toHour,
  validateAnonFeedback,
} from "@/lib/anon-feedback";
import { db, json, localDate } from "./admin";
import { bodyOf, s } from "./portal-common";

/** One network (gym Wi-Fi, a mobile carrier's shared address) may carry many members. */
const PER_NETWORK_PER_DAY = 40;
const CLOSED = "This feedback QR is switched off. Please ask at the front desk.";

/** A server-only key, so a counter's id can't be turned back into a network address. */
function hashKey() {
  return (
    process.env["FIREBASE_SERVICE_ACCOUNT"] ??
    process.env["FIREBASE_PRIVATE_KEY"] ??
    process.env["CRON_SECRET"] ??
    "anon-feedback"
  );
}
const hashed = (...parts: string[]) =>
  createHmac("sha256", hashKey()).update(parts.join("|")).digest("hex").slice(0, 40);

function networkOf(request: Request) {
  return (
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

async function gymBrand() {
  const g = (await db().doc("settings/business").get()).data() ?? {};
  return { gymName: s(g["businessName"]) || "our gym", logoUrl: s(g["logoUrl"]) };
}

async function linkInfo(token: string) {
  const [link, brand] = await Promise.all([db().doc(`feedbackLinks/${token}`).get(), gymBrand()]);
  const l = link.data();
  if (!l) return json({ error: "This feedback link is not valid." }, 404);
  return json({ on: l["active"] !== false, ...brand, place: s(l["name"]) });
}

async function submit(token: string, request: Request) {
  const body = await bodyOf(request);
  // Bots fill every box; people never see this one. Say "thanks" and keep nothing.
  if (s(body["website"]).trim()) return json({ ok: true });
  const input = cleanAnonFeedback(body);
  const problem = validateAnonFeedback(input);
  if (problem) return json({ error: problem }, 400);

  const today = localDate();
  const network = networkOf(request);
  const device = s(body["device"]).slice(0, 64);
  const linkRef = db().doc(`feedbackLinks/${token}`);
  const senderRef = db().doc(`anonFeedbackRate/s_${hashed(today, network, device)}`);
  const networkRef = db().doc(`anonFeedbackRate/n_${hashed(today, network)}`);
  const msgRef = db().collection("anonymousFeedback").doc();
  const hour = Timestamp.fromMillis(toHour(Date.now()));
  // Counters live two days; a Firestore TTL policy on `expireAt` can sweep them.
  const expireAt = Timestamp.fromMillis(Date.now() + 2 * 86_400_000);

  const result = await db().runTransaction(async (tx) => {
    const [link, sender, net] = await Promise.all([
      tx.get(linkRef),
      tx.get(senderRef),
      tx.get(networkRef),
    ]);
    const l = link.data();
    if (!l) return "gone" as const;
    if (l["active"] === false) return "off" as const;
    const linkDay = nextDayCount(l["rate"], today, ANON_LIMITS.perLinkPerDay);
    const senderDay = nextDayCount(sender.data(), today, ANON_LIMITS.perSenderPerDay);
    const netDay = nextDayCount(net.data(), today, PER_NETWORK_PER_DAY);
    if (!linkDay || !senderDay || !netDay) return "limit" as const;
    tx.set(senderRef, { ...senderDay, expireAt });
    tx.set(networkRef, { ...netDay, expireAt });
    tx.update(linkRef, {
      rate: linkDay,
      responseCount: FieldValue.increment(1),
      lastResponseAt: hour,
    });
    tx.set(msgRef, {
      linkId: token,
      linkName: s(l["name"]),
      ...input,
      day: today,
      status: "new",
      note: "",
      noteBy: "",
      resolvedBy: "",
      resolvedAt: null,
      createdAt: hour,
    });
    return "ok" as const;
  });
  if (result === "gone") return json({ error: "This feedback link is not valid." }, 404);
  if (result === "off") return json({ error: CLOSED }, 409);
  if (result === "limit")
    return json(
      { error: "Thanks! You have sent a lot of feedback today. Please try again tomorrow." },
      429,
    );
  return json({ ok: true });
}

export async function handleAnonFeedback(request: Request, url: URL): Promise<Response> {
  const token = url.pathname.replace(/^\/api\/feedback\//, "");
  if (!isFeedbackToken(token)) return json({ error: "This feedback link is not valid." }, 404);
  if (request.method === "GET") return linkInfo(token);
  if (request.method === "POST") return submit(token, request);
  return json({ error: "Method not allowed." }, 405);
}
