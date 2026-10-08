/**
 * WhatsApp chats: messages members send to the gym's Cloud API number, and staff replies.
 *
 *   waChats/{waId}                     one chat per WhatsApp number (digits with country code)
 *   waChats/{waId}/messages/{wamid}    each message, in and out (id = WhatsApp's message id)
 *
 * Written only here (server); staff with "WhatsApp chats" read them live (firestore.rules).
 * WhatsApp allows a free-form reply only within 24 hours of the member's last message; after
 * that only an approved template may start the conversation again.
 *
 *   POST /api/whatsapp/chat/reply   { waId, text, replyTo? }   send a text reply
 *   POST /api/whatsapp/chat/read    { waId }                    unread → 0, blue ticks for the member
 *   POST /api/whatsapp/chat/status                              is the Cloud API / webhook set up
 *   GET  /api/whatsapp/chat/media?chat=…&msg=…                  a photo / voice note / file
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, json, requireFeature, text } from "./admin";

const env = (k: string, fallback = "") => (process.env[k] ?? fallback).trim();
const config = () => ({
  token: env("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
  version: env("WHATSAPP_GRAPH_API_VERSION", "v23.0"),
  base: env("WHATSAPP_GRAPH_BASE", "https://graph.facebook.com"),
});

const FEATURE = "whatsappChats";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 4096;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export const chatRef = (waId: string) => db().doc(`waChats/${waId}`);
const messageRef = (waId: string, wamid: string) =>
  db().doc(`waChats/${waId}/messages/${safeId(wamid)}`);
/** WhatsApp ids are "wamid.HBgM…" (letters, digits, = + / . -): "/" can't be in a doc id. */
const safeId = (wamid: string) => wamid.replace(/\//g, "_");
const validWaId = (v: unknown) => (typeof v === "string" && /^\d{8,15}$/.test(v) ? v : "");
const millis = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/** One line for the chat list, like WhatsApp's ("📷 Photo", "🎤 Voice message"). */
function preview(m: { type: string; text?: string; caption?: string; filename?: string }) {
  const label: Record<string, string> = {
    image: "📷 Photo",
    video: "🎥 Video",
    audio: "🎤 Voice message",
    document: `📄 ${m.filename || "Document"}`,
    sticker: "Sticker",
    location: "📍 Location",
    contacts: "👤 Contact",
  };
  if (m.text) return m.text.slice(0, 200);
  if (m.caption) return `${label[m.type] ?? ""} ${m.caption}`.trim().slice(0, 200);
  return label[m.type] ?? "Message";
}

/** The member this number belongs to (by their phone or WhatsApp number), if any. */
async function findMember(waId: string) {
  const last10 = waId.slice(-10);
  const pick = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
    const c = d.data();
    return {
      clientId: d.id,
      clientName: String(c["fullName"] ?? ""),
      clientPhotoUrl: (c["profilePhotoUrl"] as string | null) ?? null,
      clientCode: String(c["clientCode"] ?? ""),
    };
  };
  const byPhone = await db()
    .collection("clients")
    .where("phoneNormalized", "==", last10)
    .limit(1)
    .get();
  if (!byPhone.empty) return pick(byPhone.docs[0]!);
  const byWa = await db()
    .collection("clients")
    .where("whatsappPhone", "in", [last10, waId, `+${waId}`, `+91 ${last10}`, `+91${last10}`])
    .limit(1)
    .get();
  return byWa.empty ? null : pick(byWa.docs[0]!);
}

type Incoming = Record<string, unknown> & { from?: string; id?: string; type?: string };

/** What we keep of one incoming message (text, caption, media id, place, button tapped…). */
function parseIncoming(m: Incoming) {
  const type = String(m.type ?? "unsupported");
  const part = (m[type] ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const out: Record<string, unknown> = { type };
  if (type === "text") out["text"] = s(part["body"]);
  else if (["image", "video", "audio", "document", "sticker"].includes(type)) {
    out["media"] = {
      id: s(part["id"]),
      mime: s(part["mime_type"]),
      ...(part["voice"] === true ? { voice: true } : {}),
    };
    if (s(part["caption"])) out["caption"] = s(part["caption"]);
    if (s(part["filename"])) out["filename"] = s(part["filename"]);
  } else if (type === "location")
    out["location"] = {
      lat: Number(part["latitude"] ?? 0),
      lng: Number(part["longitude"] ?? 0),
      name: s(part["name"]),
      address: s(part["address"]),
    };
  else if (type === "button") {
    out["type"] = "text";
    out["text"] = s(part["text"]);
  } else if (type === "interactive") {
    const reply = (part["button_reply"] ?? part["list_reply"] ?? {}) as Record<string, unknown>;
    out["type"] = "text";
    out["text"] = s(reply["title"]);
  } else if (type === "contacts") {
    const first = (Array.isArray(m["contacts"]) ? m["contacts"][0] : {}) as Record<string, unknown>;
    const name = (first?.["name"] ?? {}) as Record<string, unknown>;
    const phones = (Array.isArray(first?.["phones"]) ? first["phones"] : []) as {
      phone?: string;
    }[];
    out["contact"] = { name: s(name["formatted_name"]), phone: s(phones[0]?.phone) };
  } else out["type"] = "unsupported";
  const context = m["context"] as { id?: string } | undefined;
  if (context?.id) out["replyTo"] = safeId(context.id);
  return out;
}

/**
 * Webhook: members' messages (`value.messages`) and their WhatsApp names (`value.contacts`).
 * A message WhatsApp sends twice is saved once (its id is the doc id).
 */
export async function receiveMessages(value: {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: Incoming[];
}) {
  const ours = env("WHATSAPP_PHONE_NUMBER_ID");
  // Another number on the same Meta app is not this gym's.
  if (ours && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ours) return;
  const names = new Map(
    (value.contacts ?? []).map((c) => [String(c.wa_id ?? ""), String(c.profile?.name ?? "")]),
  );
  for (const m of value.messages ?? []) {
    const waId = validWaId(m.from);
    const wamid = String(m.id ?? "");
    if (!waId || !wamid) continue;
    const at = Timestamp.fromMillis(Number(m["timestamp"] ?? 0) * 1000 || Date.now());
    if (m.type === "reaction") {
      await saveReaction(waId, m["reaction"] as { message_id?: string; emoji?: string }, at);
      continue;
    }
    const parsed = parseIncoming(m);
    const chat = chatRef(waId);
    // Looked up on every message: a new photo / name (or a number that just became a member's).
    const member = await findMember(waId);
    await db().runTransaction(async (tx) => {
      const ref = messageRef(waId, wamid);
      const [seen, current] = await Promise.all([tx.get(ref), tx.get(chat)]);
      if (seen.exists) return;
      tx.set(ref, { ...parsed, wamid, direction: "in", at, status: "received" });
      const c = current.data() ?? {};
      const newest = millis(at) >= millis(c["lastMessageAt"]);
      tx.set(
        chat,
        {
          waId,
          profileName: names.get(waId) || c["profileName"] || "",
          ...(member ?? {}),
          unread: FieldValue.increment(1),
          // Late deliveries of older messages don't move the 24-hour reply window back.
          ...(millis(at) >= millis(c["lastInboundAt"])
            ? { lastInboundAt: at, lastInboundWamid: wamid }
            : {}),
          ...(newest
            ? {
                lastMessageAt: at,
                lastText: preview(parsed as { type: string }),
                lastDirection: "in",
                lastStatus: "",
              }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }
}

/** A member's 👍 / ❤️ on a message shows under that message (empty emoji = removed). */
async function saveReaction(
  waId: string,
  r: { message_id?: string; emoji?: string } | undefined,
  at: Timestamp,
) {
  if (!r?.message_id) return;
  const target = messageRef(waId, r.message_id);
  const snap = await target.get();
  if (!snap.exists) return;
  await target.update({ reaction: r.emoji ?? "" });
  if (r.emoji)
    await chatRef(waId).set(
      {
        lastMessageAt: at,
        lastText: `Reacted ${r.emoji} to "${preview(snap.data() as { type: string }).slice(0, 40)}"`,
        lastDirection: "in",
        lastStatus: "",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Delivery ticks for a message in a chat (a reply or a bill / reminder the app sent). */
export async function chatStatus(waId: string, wamid: string, state: string, error?: string) {
  if (!validWaId(waId) || !(state in rank)) return;
  const ref = messageRef(waId, wamid);
  await db().runTransaction(async (tx) => {
    const [snap, chat] = await Promise.all([tx.get(ref), tx.get(chatRef(waId))]);
    if (!snap.exists) return;
    const current = String(snap.data()?.["status"] ?? "sent");
    if (state !== "failed" && (rank[state] ?? 0) <= (rank[current] ?? 0)) return;
    tx.update(ref, { status: state, ...(error ? { error } : {}) });
    if (chat.data()?.["lastMessageId"] === safeId(wamid))
      tx.update(chatRef(waId), { lastStatus: state });
  });
}

/**
 * Puts a message the app sent (bill, reminder, announcement) into the member's chat, so staff
 * see what the member is replying to. Never fails the send.
 */
export async function recordOutgoing(input: {
  waId: string;
  wamid: string;
  text: string;
  template?: string;
  by?: string;
}) {
  const waId = validWaId(input.waId);
  if (!waId || !input.wamid) return;
  try {
    const now = Timestamp.now();
    const member = (await chatRef(waId).get()).data()?.["clientId"] ? null : await findMember(waId);
    const batch = db().batch();
    batch.set(messageRef(waId, input.wamid), {
      type: input.template ? "template" : "text",
      text: input.text.slice(0, MAX_TEXT),
      wamid: input.wamid,
      ...(input.template ? { template: input.template } : {}),
      direction: "out",
      at: now,
      status: "sent",
      by: input.by ?? "",
    });
    batch.set(
      chatRef(waId),
      {
        waId,
        ...(member ?? {}),
        lastMessageAt: now,
        lastText: input.text.slice(0, 200),
        lastDirection: "out",
        lastStatus: "sent",
        lastMessageId: safeId(input.wamid),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
  } catch {
    // The message itself went; only its copy in the chat is missing.
  }
}

async function graph(path: string, body: unknown) {
  const c = config();
  const r = await fetch(`${c.base}/${c.version}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  let parsed: { messages?: { id?: string }[]; error?: { code?: number; message?: string } } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // Not JSON: handled by the status below.
  }
  return { ok: r.ok, status: r.status, body: parsed };
}

const staffName = (u: { name?: string; email?: string }) =>
  String(u.name || u.email?.split("@")[0] || "Staff");

async function reply(request: Request) {
  const user = await requireFeature(request, FEATURE);
  if (!user) return json({ error: "You don't have WhatsApp chats switched on." }, 403);
  const c = config();
  if (!c.token || !c.phoneNumberId)
    return json({ error: "WhatsApp Cloud API is not connected." }, 412);
  const input = (await request.json().catch(() => ({}))) as {
    waId?: unknown;
    text?: unknown;
    replyTo?: unknown;
  };
  const waId = validWaId(input.waId);
  const body = typeof input.text === "string" ? input.text.trim() : "";
  if (!waId) return json({ error: "Choose a chat." }, 400);
  if (!body) return json({ error: "Type a message." }, 400);
  if (body.length > MAX_TEXT) return json({ error: "Message is too long (4,096 letters)." }, 400);
  const chat = await chatRef(waId).get();
  if (!chat.exists) return json({ error: "Chat not found." }, 404);
  if (Date.now() - millis(chat.data()?.["lastInboundAt"]) > DAY_MS)
    return json(
      {
        error:
          "More than 24 hours since their last message: WhatsApp allows only an approved template now.",
        code: "window_closed",
      },
      409,
    );
  const replyTo = typeof input.replyTo === "string" && input.replyTo ? input.replyTo : "";
  const quoted = replyTo && replyTo.length < 200 ? await messageRef(waId, replyTo).get() : null;
  const r = await graph(`${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waId,
    type: "text",
    text: { preview_url: true, body },
    ...(quoted?.exists && quoted.data()?.["wamid"]
      ? { context: { message_id: String(quoted.data()?.["wamid"]) } }
      : {}),
  });
  const wamid = String(r.body.messages?.[0]?.id ?? "");
  if (!r.ok || !wamid) {
    const code = r.body.error?.code;
    return json(
      {
        error:
          code === 131047
            ? "More than 24 hours since their last message: WhatsApp allows only an approved template now."
            : r.status === 401
              ? "WhatsApp credentials were rejected."
              : r.status === 429
                ? "WhatsApp rate limit reached. Try again in a minute."
                : "WhatsApp could not send this message.",
      },
      502,
    );
  }
  const now = Timestamp.now();
  const batch = db().batch();
  batch.set(messageRef(waId, wamid), {
    type: "text",
    text: body,
    wamid,
    direction: "out",
    at: now,
    status: "sent",
    by: staffName(user),
    byUid: user.uid,
    ...(quoted?.exists ? { replyTo: safeId(replyTo) } : {}),
  });
  batch.update(chatRef(waId), {
    lastMessageAt: now,
    lastText: body.slice(0, 200),
    lastDirection: "out",
    lastStatus: "sent",
    lastMessageId: safeId(wamid),
    // Replying means it was read.
    unread: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return json({ ok: true, id: safeId(wamid) });
}

async function markRead(request: Request) {
  if (!(await requireFeature(request, FEATURE))) return json({ error: "Not allowed." }, 403);
  const input = (await request.json().catch(() => ({}))) as { waId?: unknown };
  const waId = validWaId(input.waId);
  if (!waId) return json({ error: "Choose a chat." }, 400);
  const ref = chatRef(waId);
  const chat = (await ref.get()).data();
  if (!chat) return json({ error: "Chat not found." }, 404);
  if (!chat["unread"]) return json({ ok: true });
  await ref.update({ unread: 0 });
  // Blue ticks on the member's phone (marks this and every earlier message read).
  const c = config();
  const last = String(chat["lastInboundWamid"] ?? "");
  if (c.token && c.phoneNumberId && last)
    await graph(`${c.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: last,
    }).catch(() => undefined);
  return json({ ok: true });
}

async function setupStatus(request: Request) {
  if (!(await requireFeature(request, FEATURE))) return json({ error: "Not allowed." }, 403);
  const c = config();
  const st = (await db().doc("whatsappWebhookStatus/meta").get()).data() ?? {};
  const accepted = millis(st["acceptedAt"]);
  const rejected = millis(st["rejectedAt"]);
  return json({
    connected: !!(c.token && c.phoneNumberId),
    appSecret: !!env("WHATSAPP_APP_SECRET"),
    // Meta's last call was refused (no / wrong App secret): incoming messages are being lost.
    webhook: rejected > accepted ? "refused" : accepted ? "ok" : "never",
  });
}

/** Streams one photo / voice note / file of a chat message from WhatsApp to staff. */
async function media(request: Request, url: URL) {
  if (!(await requireFeature(request, FEATURE))) return text("Not allowed", 403);
  const waId = validWaId(url.searchParams.get("chat"));
  const msg = url.searchParams.get("msg") ?? "";
  if (!waId || !msg || msg.length > 200) return text("Bad request", 400);
  const snap = await db()
    .doc(`waChats/${waId}/messages/${msg.replace(/\//g, "_")}`)
    .get();
  const m = snap.data()?.["media"] as { id?: string; mime?: string } | undefined;
  if (!m?.id) return text("Not found", 404);
  const c = config();
  if (!c.token) return text("WhatsApp is not connected", 412);
  const auth = { Authorization: `Bearer ${c.token}` };
  const info = await fetch(`${c.base}/${c.version}/${encodeURIComponent(m.id)}`, { headers: auth });
  if (!info.ok) return text("WhatsApp no longer has this file (kept 30 days).", 410);
  const { url: fileUrl, file_size } = (await info.json()) as { url?: string; file_size?: number };
  if (!fileUrl || (file_size ?? 0) > MAX_MEDIA_BYTES) return text("File unavailable", 410);
  // Meta's media links are on its own CDN; only those are fetched with the token.
  const host = new URL(fileUrl).hostname;
  const local = c.base !== "https://graph.facebook.com" && fileUrl.startsWith(c.base);
  if (!local && !/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/.test(host))
    return text("File unavailable", 410);
  const file = await fetch(fileUrl, { headers: auth });
  if (!file.ok || !file.body) return text("File unavailable", 410);
  const type = (m.mime || file.headers.get("content-type") || "application/octet-stream").split(
    ";",
  )[0]!;
  return new Response(file.body, {
    headers: {
      // Only what a browser shows safely inline; anything else downloads.
      "content-type": /^(image\/(jpeg|png|webp)|audio\/|video\/mp4|application\/pdf)/.test(type)
        ? type
        : "application/octet-stream",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, max-age=3600",
    },
  });
}

export function handleChat(request: Request, url: URL, action: string) {
  if (action === "chat/media" && request.method === "GET") return media(request, url);
  if (request.method !== "POST") return text("Method not allowed", 405);
  if (action === "chat/reply") return reply(request);
  if (action === "chat/read") return markRead(request);
  if (action === "chat/status") return setupStatus(request);
  return text("Not found", 404);
}
