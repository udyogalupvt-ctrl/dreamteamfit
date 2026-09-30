/**
 * Phone notifications for the member app and trainer app (Web Push: free, no WhatsApp cost).
 *
 *   GET  /api/push/key          the gym's public key (a phone needs it to turn notifications on)
 *   POST /api/push/subscribe    member / trainer app: { subscription } this phone gets notifications
 *   POST /api/push/unsubscribe  member / trainer app: { endpoint } this phone stops getting them
 *   POST /api/push/chat         member / trainer app: { clientId } right after sending a chat message
 *   POST /api/push/members      staff: { clientIds, title, body } (announcements)
 *
 * The keys are made once by the server and kept in serverSecrets/webPush (server only), so there
 * is nothing to set up on Vercel. Each phone is one pushSubscriptions doc; a phone that removed the
 * app or blocked notifications is forgotten the first time a send to it is refused.
 *
 * Encryption (RFC 8291, aes128gcm) and the VAPID signature (RFC 8292) use node:crypto only.
 */
import {
  createCipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type ECDH,
} from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { OWNER_EMAILS } from "@/constants/owners";
import { db, json, requireStaff } from "./admin";
import { portalUser } from "./portal";

export type PushMessage = {
  title: string;
  body: string;
  /** Added to the app's own link, e.g. "?tab=payments". */
  path?: string;
  /** A newer notification with the same tag replaces the older one on the phone. */
  tag?: string;
};

type Keys = { publicKey: string; x: string; y: string; d: string };
const b64u = (b: Buffer) => b.toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

let keysCache: Keys | null = null;
/** The gym's push keys; made on first use. */
async function pushKeys(): Promise<Keys> {
  if (keysCache) return keysCache;
  const ref = db().doc("serverSecrets/webPush");
  const saved = (await ref.get()).data() as Keys | undefined;
  if (saved?.d) return (keysCache = saved);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { x: string; y: string; d: string };
  const made: Keys = {
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
    publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])),
  };
  // Two first calls at once: the one saved first wins, the other reads it back.
  await ref.create({ ...made, createdAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return (keysCache = (await ref.get()).data() as Keys);
}

/** HKDF with one output block (RFC 5869), all that Web Push needs. */
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) =>
  createHmac("sha256", createHmac("sha256", salt).update(ikm).digest())
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);

/**
 * RFC 8291 message encryption. `salt` and `local` are only passed by the test that checks the
 * result against the RFC's worked example.
 */
export function encryptPush(
  payload: Buffer,
  p256dh: string,
  auth: string,
  salt = randomBytes(16),
  local?: ECDH,
) {
  const uaPublic = unb64u(p256dh);
  const ecdh = local ?? createECDH("prime256v1");
  const asPublic = local ? local.getPublicKey() : ecdh.generateKeys();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(
    unb64u(auth),
    secret,
    Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
    32,
  );
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, sealed]);
}

/** RFC 8292: "vapid t=<signed JWT>, k=<public key>" for one push service. */
function vapid(endpoint: string, keys: Keys) {
  const part = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: `mailto:${OWNER_EMAILS[0]}`,
  })}`;
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: keys.x, y: keys.y, d: keys.d },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${keys.publicKey}`;
}

/**
 * Only the browsers' own push services (Chrome, Firefox, Safari, Edge): the server never posts
 * to an address a phone made up.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const PUSH_DOMAINS = [".push.apple.com", ".notify.windows.com"];
const pushHostOk = (endpoint: string) => {
  try {
    const u = new URL(endpoint);
    if (
      u.protocol === "https:" &&
      (PUSH_HOSTS.includes(u.hostname) || PUSH_DOMAINS.some((h) => u.hostname.endsWith(h)))
    )
      return true;
    // Local tests only: a fake push service on this computer.
    const test = process.env["PUSH_TEST_HOST"];
    return !!test && u.origin === test;
  } catch {
    return false;
  }
};

const subId = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex").slice(0, 40);

type Sub = { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData };

async function sendOne(sub: Sub, msg: PushMessage, keys: Keys) {
  const endpoint = s(sub.data["endpoint"]);
  if (!pushHostOk(endpoint)) return false;
  const payload = Buffer.from(
    JSON.stringify({
      title: msg.title.slice(0, 80),
      body: msg.body.slice(0, 400),
      url: `${s(sub.data["appPath"])}${msg.path ?? ""}`,
      tag: msg.tag ?? "",
    }),
  );
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: vapid(endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: encryptPush(payload, s(sub.data["p256dh"]), s(sub.data["auth"])),
  }).catch(() => null);
  // Gone: the app was removed or notifications were blocked on that phone.
  if (r && (r.status === 404 || r.status === 410)) await sub.ref.delete().catch(() => undefined);
  return !!r && r.ok;
}

/** Subscriptions of these people ("member:<id>" / "trainer:<id>"). */
async function subsOf(owners: string[]): Promise<Sub[]> {
  const unique = [...new Set(owners.filter(Boolean))];
  if (!unique.length) return [];
  const col = db().collection("pushSubscriptions");
  // Many people (an announcement): one read of every phone of that kind is cheaper.
  if (unique.length > 60) {
    const kinds = [...new Set(unique.map((o) => o.split(":")[0]!))];
    const wanted = new Set(unique);
    const snaps = await Promise.all(kinds.map((k) => col.where("kind", "==", k).get()));
    return snaps
      .flatMap((x) => x.docs)
      .filter((d) => wanted.has(s(d.data()["owner"])))
      .map((d) => ({ ref: d.ref, data: d.data() }));
  }
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((c) => col.where("owner", "in", c).get()));
  return snaps.flatMap((x) => x.docs).map((d) => ({ ref: d.ref, data: d.data() }));
}

let allowedCache = { at: 0, on: true };
/** Settings → Reminders → App notifications (on unless switched off). Re-read at most once a minute. */
async function pushAllowed() {
  if (Date.now() - allowedCache.at < 60_000) return allowedCache.on;
  const d = (await db().doc("settings/automation").get()).data();
  allowedCache = { at: Date.now(), on: d?.["pushEnabled"] !== false };
  return allowedCache.on;
}

/**
 * Sends to every phone of these people. Returns how many phones took it (0 when App
 * notifications are switched off in Settings). Never throws.
 */
export async function pushTo(owners: string[], msg: PushMessage) {
  try {
    if (!(await pushAllowed())) return 0;
    const subs = await subsOf(owners);
    if (!subs.length) return 0;
    const keys = await pushKeys();
    let ok = 0;
    for (let i = 0; i < subs.length; i += 10) {
      const results = await Promise.all(subs.slice(i, i + 10).map((x) => sendOne(x, msg, keys)));
      ok += results.filter(Boolean).length;
    }
    return ok;
  } catch (e) {
    console.error("push failed", String(e));
    return 0;
  }
}

export const memberOwner = (clientId: string) => `member:${clientId}`;

// ------------------------------------------------------------------ endpoints

async function subscribe(request: Request) {
  const who = await portalUser(request);
  if (!who) return json({ error: "Please sign in again." }, 401);
  const body = (await request.json().catch(() => ({}))) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  };
  const endpoint = s(body.subscription?.endpoint);
  const p256dh = s(body.subscription?.keys?.p256dh);
  const auth = s(body.subscription?.keys?.auth);
  if (
    !pushHostOk(endpoint) ||
    endpoint.length > 1000 ||
    unb64u(p256dh).length !== 65 ||
    unb64u(auth).length !== 16
  )
    return json({ error: "This browser's notification address was not accepted." }, 400);
  await db()
    .doc(`pushSubscriptions/${subId(endpoint)}`)
    .set({
      owner: `${who.kind}:${who.id}`,
      kind: who.kind,
      appPath: `/${who.kind === "member" ? "m" : "t"}/${who.code}`,
      endpoint,
      p256dh,
      auth,
      userAgent: s(request.headers.get("user-agent")).slice(0, 200),
      updatedAt: FieldValue.serverTimestamp(),
    });
  return json({ ok: true });
}

async function unsubscribe(request: Request) {
  const who = await portalUser(request);
  if (!who) return json({ error: "Please sign in again." }, 401);
  const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
  const ref = db().doc(`pushSubscriptions/${subId(s(body.endpoint))}`);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.["owner"] === `${who.kind}:${who.id}`) await ref.delete();
  return json({ ok: true });
}

/** A chat message was just sent: tell the other side's phones (at most one per 20 seconds). */
async function chat(request: Request) {
  const who = await portalUser(request);
  if (!who) return json({ error: "Please sign in again." }, 401);
  const body = (await request.json().catch(() => ({}))) as { clientId?: unknown };
  const clientId = s(body.clientId);
  if (!clientId) return json({ error: "clientId is required." }, 400);
  const ref = db().doc(`chats/${clientId}`);
  const t = (await ref.get()).data();
  if (!t) return json({ sent: 0 });
  const mine = who.kind === "member" ? who.id === clientId : who.id === s(t["trainerId"]);
  if (!mine) return json({ error: "Not allowed." }, 403);
  const millis = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
  const lastAt = millis(t["lastAt"]);
  if (t["lastFrom"] !== who.kind || Date.now() - lastAt > 120_000) return json({ sent: 0 });
  if (Date.now() - millis(t["pushedAt"]) < 20_000) return json({ sent: 0 });
  await ref.update({ pushedAt: FieldValue.serverTimestamp() });
  const text = s(t["lastText"]);
  const sent =
    who.kind === "member"
      ? await pushTo([`trainer:${s(t["trainerId"])}`], {
          title: s(t["clientName"]) || "Member",
          body: text,
          path: `?member=${encodeURIComponent(clientId)}&tab=chat`,
          tag: `chat-${clientId}`,
        })
      : await pushTo([memberOwner(clientId)], {
          title: `${s(t["trainerName"]) || "Your trainer"} (trainer)`,
          body: text,
          path: "?tab=chat",
          tag: `chat-${clientId}`,
        });
  return json({ sent });
}

async function members(request: Request) {
  if (!(await requireStaff(request))) return json({ error: "Sign in required." }, 401);
  const body = (await request.json().catch(() => ({}))) as {
    clientIds?: unknown;
    title?: unknown;
    body?: unknown;
  };
  const ids = Array.isArray(body.clientIds) ? body.clientIds.map(s).filter(Boolean) : [];
  const title = s(body.title).trim();
  const text = s(body.body).trim();
  if (!ids.length || ids.length > 5000 || !title || !text)
    return json({ error: "Who and what to send are required." }, 400);
  const sent = await pushTo(ids.map(memberOwner), { title, body: text, tag: "announcement" });
  return json({ sent });
}

export async function handlePush(request: Request, url: URL): Promise<Response> {
  const action = url.pathname.replace(/^\/api\/push\/?/, "").replace(/\/+$/, "");
  if (request.method === "GET" && action === "key")
    return json({ publicKey: (await pushKeys()).publicKey });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (action === "subscribe") return subscribe(request);
  if (action === "unsubscribe") return unsubscribe(request);
  if (action === "chat") return chat(request);
  if (action === "members") return members(request);
  return json({ error: "Not found" }, 404);
}
