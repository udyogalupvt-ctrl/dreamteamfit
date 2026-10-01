/**
 * Sending from the gym's OWN WhatsApp number through an OpenWA gateway
 * (https://github.com/rmyndharis/OpenWA, the same kind of "WhatsApp instance" the old software
 * used). The number is linked to the gateway like WhatsApp Web ("Linked devices"), so the gym
 * keeps using WhatsApp on its phone. Messages are plain text (no Meta templates); the wording is
 * in src/lib/whatsapp-texts.ts and can be changed in Settings → WhatsApp.
 *
 *   POST /api/whatsapp/gateway          settings: save { url, sessionId, apiKey? } and check it
 *   POST /api/whatsapp/gateway-status   settings: { action: status | start | qr | pairing, phone? }
 *   POST /api/whatsapp/gateway-webhook  the gateway: delivery ticks and phone status (signed)
 *
 * The API key lives only in serverSecrets/whatsappGateway (Firestore rules: no browser access);
 * OPENWA_URL / OPENWA_SESSION_ID / OPENWA_API_KEY on Vercel are used when Settings has none.
 *
 * Note: this is WhatsApp Web automation, not Meta's official API. WhatsApp can restrict a number
 * that sends a lot of messages quickly, so announcements are sent slowly from the browser.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { PHONE_TEXT_LINKS, renderPhoneText } from "@/lib/whatsapp-texts";
import { appOrigin, db, json, requireFeature, text } from "./admin";

const secretRef = () => db().doc("serverSecrets/whatsappGateway");
const settingsRef = () => db().doc("settings/whatsapp");
const env = (k: string) => (process.env[k] ?? "").trim();

export interface GatewayConfig {
  sender: "cloud" | "phone";
  url: string;
  sessionId: string;
  apiKey: string;
  texts: Record<string, string>;
  webhookSecret: string;
}

// A warm server instance re-reads the settings at most every 30 s (each send would cost 2 reads).
let cached: { at: number; value: GatewayConfig } | null = null;
export async function gatewayConfig(fresh = false): Promise<GatewayConfig> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value;
  const [ws, sec] = await Promise.all([settingsRef().get(), secretRef().get()]);
  const s = ws.data() ?? {};
  const k = sec.data() ?? {};
  const value: GatewayConfig = {
    sender: s["sender"] === "phone" ? "phone" : "cloud",
    url: (String(s["gatewayUrl"] ?? "") || env("OPENWA_URL")).replace(/\/+$/, ""),
    sessionId: String(s["gatewaySessionId"] ?? "") || env("OPENWA_SESSION_ID"),
    apiKey: String(k["apiKey"] ?? "") || env("OPENWA_API_KEY"),
    texts: (s["phoneTexts"] as Record<string, string> | undefined) ?? {},
    webhookSecret: String(k["webhookSecret"] ?? ""),
  };
  cached = { at: Date.now(), value };
  return value;
}

type Session = {
  id?: string;
  status?: string;
  phone?: string | null;
  pushName?: string | null;
  lastError?: string | null;
};

/** One call to the gateway. Never throws: a dead or slow gateway is a plain "ok: false". */
async function call<T>(
  g: Pick<GatewayConfig, "url" | "apiKey">,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(`${g.url}/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        "X-API-Key": g.apiKey,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await response.text();
    let data: unknown = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw.slice(0, 200) };
    }
    if (response.ok) return { ok: true, data: data as T };
    return { ok: false, status: response.status, error: plainError(response.status, data) };
  } catch (e) {
    const timeout = String((e as Error)?.name ?? "").includes("Timeout");
    return {
      ok: false,
      status: 0,
      error: timeout
        ? "The WhatsApp gateway did not answer in time. Check that it is running."
        : "Can't reach the WhatsApp gateway. Check its address and that it is running.",
    };
  }
}

/** The gateway's answer in plain words for the front desk (never the key or raw details). */
function plainError(status: number, data: unknown) {
  const d = (data ?? {}) as { message?: unknown; code?: unknown };
  const message = Array.isArray(d.message) ? d.message.join(", ") : String(d.message ?? "");
  if (status === 401)
    return "The WhatsApp gateway refused the API key (token). Check it in Settings.";
  if (status === 403)
    return "This API key is not allowed to use that WhatsApp instance. Check the instance ID and key.";
  if (status === 404) return "WhatsApp instance not found on the gateway. Check the instance ID.";
  if (status === 429)
    return d.code === "SEND_PACING_LIMITED"
      ? "Today's sending limit of the gym's WhatsApp number is reached. Try again tomorrow."
      : "Too many messages at once. Try again in a minute.";
  if (status === 409 || status === 503)
    return "The gym's WhatsApp phone is reconnecting. Try again in a minute.";
  if (status === 400 && /not (active|started|ready)|session/i.test(message))
    return "The gym's WhatsApp phone is not connected. Open Settings → WhatsApp and link it again (scan the QR).";
  if (status >= 500) return "WhatsApp could not send this message from the gym's phone. Try again.";
  return message.slice(0, 160) || `The WhatsApp gateway answered ${status}.`;
}

const sessionPath = (g: GatewayConfig) => `/sessions/${encodeURIComponent(g.sessionId)}`;

/** Where a message's link goes: the bill page or the member app. */
function linkFor(kind: string, param: string) {
  const target = PHONE_TEXT_LINKS[kind as keyof typeof PHONE_TEXT_LINKS];
  if (!param || !target) return "";
  return `${appOrigin()}/${target === "invoice" ? "invoice" : "m"}/${encodeURIComponent(param)}`;
}

/** Sends one message as text from the gym's number. Same values the Meta templates get. */
export async function sendFromPhone(input: {
  to: string;
  kind: string;
  bodyParams: string[];
  buttonUrlParam?: string;
}): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string; code: string }> {
  const g = await gatewayConfig();
  if (!g.url || !g.sessionId || !g.apiKey)
    return {
      ok: false,
      error: "The gym's WhatsApp number is not connected yet (Settings → WhatsApp).",
      code: "not_configured",
    };
  const message = renderPhoneText(
    input.kind,
    input.bodyParams.map((p) => String(p ?? "")),
    linkFor(input.kind, input.buttonUrlParam ?? ""),
    g.texts,
  ).slice(0, 4000);
  const r = await call<{ messageId?: string }>(g, `${sessionPath(g)}/messages/send-text`, {
    method: "POST",
    body: { chatId: `${input.to}@c.us`, text: message },
  });
  if (!r.ok) return { ok: false, error: r.error, code: `gateway_${r.status}` };
  return { ok: true, providerMessageId: String(r.data.messageId ?? "") };
}

/** "919666446131" → "+91 96664 46131" */
const prettyPhone = (p: string) =>
  /^91\d{10}$/.test(p) ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p ? `+${p}` : "";

const STATUS_WORDS: Record<string, string> = {
  ready: "Connected",
  qr_ready: "Waiting for the QR to be scanned",
  authenticating: "Linking…",
  initializing: "Starting…",
  created: "Not started",
  disconnected: "Disconnected",
  action_required: "Needs attention on the phone",
  failed: "Failed",
};

/** Connection state for Settings / Test connection, and kept on settings/whatsapp. */
export async function gatewaySession(g: GatewayConfig) {
  const r = await call<Session>(g, sessionPath(g));
  if (!r.ok) return { ok: false as const, error: r.error };
  const status = String(r.data.status ?? "unknown");
  const phone = String(r.data.phone ?? "");
  await settingsRef()
    .set(
      {
        gatewayPhone: phone,
        gatewayStatus: status,
        gatewayCheckedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => undefined);
  return {
    ok: true as const,
    status,
    statusLabel: STATUS_WORDS[status] ?? status,
    phone,
    phoneLabel: prettyPhone(phone),
    pushName: String(r.data.pushName ?? ""),
    lastError: String(r.data.lastError ?? ""),
  };
}

/** For Settings → Test connection when sending from the gym's number. */
export async function gatewayTest() {
  const g = await gatewayConfig(true);
  if (!g.url || !g.sessionId || !g.apiKey)
    return {
      configured: false,
      detail: "Enter the WhatsApp gateway address, instance ID and token, then Save connection.",
    };
  const s = await gatewaySession(g);
  if (!s.ok) return { configured: false, detail: s.error };
  return s.status === "ready"
    ? {
        configured: true,
        detail: `The gym's WhatsApp number ${s.phoneLabel || ""} is connected. Messages go out from it.`,
      }
    : {
        configured: false,
        detail: `The gym's WhatsApp is not connected (${s.statusLabel}). Link the phone in Settings → WhatsApp (scan the QR).`,
      };
}

/**
 * Delivery ticks from the gateway: registered (or updated) once the connection is saved, signed
 * with a secret only the server knows. Best effort: a key that may not add webhooks still sends.
 */
async function registerWebhook(g: GatewayConfig) {
  const origin = appOrigin();
  if (!origin || !/^https?:\/\//.test(origin)) return "unknown address";
  const url = `${origin}/api/whatsapp/gateway-webhook`;
  let secret = g.webhookSecret;
  if (!secret) {
    secret = randomBytes(24).toString("hex");
    await secretRef().set({ webhookSecret: secret }, { merge: true });
  }
  const body = {
    url,
    events: ["message.ack", "message.failed", "session.status", "session.disconnected"],
    secret,
  };
  const list = await call<{ id: string; url: string }[]>(g, `${sessionPath(g)}/webhooks`);
  const existing =
    list.ok && Array.isArray(list.data) ? list.data.find((w) => w.url === url) : null;
  const r = existing
    ? await call(g, `${sessionPath(g)}/webhooks/${encodeURIComponent(existing.id)}`, {
        method: "PUT",
        body,
      })
    : await call(g, `${sessionPath(g)}/webhooks`, { method: "POST", body });
  return r.ok ? "on" : r.error;
}

async function saveConnection(request: Request) {
  if (!(await requireFeature(request, "settings")))
    return json({ error: "Only logins with Settings can change WhatsApp." }, 403);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const url = String(body["url"] ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  const sessionId = String(body["sessionId"] ?? "").trim();
  const typedKey = String(body["apiKey"] ?? "").trim();
  if (!/^https?:\/\/[^\s/]+/i.test(url))
    return json({ error: "Enter the gateway address, starting with https://" }, 400);
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(sessionId))
    return json({ error: "Enter the instance (session) ID." }, 400);
  const current = await gatewayConfig(true);
  const apiKey = typedKey || current.apiKey;
  if (!apiKey) return json({ error: "Enter the API key (token)." }, 400);
  const g: GatewayConfig = { ...current, url, sessionId, apiKey };
  // Saved only when the gateway accepts it, so a typing mistake never stops the messages.
  const check = await call<Session>(g, sessionPath(g));
  if (!check.ok) return json({ error: check.error }, 400);
  if (typedKey) await secretRef().set({ apiKey: typedKey }, { merge: true });
  await settingsRef().set(
    {
      gatewayUrl: url,
      gatewaySessionId: sessionId,
      gatewayPhone: String(check.data.phone ?? ""),
      gatewayStatus: String(check.data.status ?? ""),
      gatewayCheckedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  cached = null;
  const webhook = await registerWebhook({
    ...g,
    webhookSecret: (await gatewayConfig(true)).webhookSecret,
  });
  const s = await gatewaySession(g);
  return json({ ...(s.ok ? s : {}), webhook, keySaved: true });
}

async function connectionAction(request: Request) {
  if (!(await requireFeature(request, "settings")))
    return json({ error: "Only logins with Settings can change WhatsApp." }, 403);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body["action"] ?? "status");
  const g = await gatewayConfig(true);
  if (!g.url || !g.sessionId || !g.apiKey)
    return json({ error: "Save the gateway connection first." }, 400);
  if (action === "start") {
    const r = await call<Session>(g, `${sessionPath(g)}/start`, { method: "POST" });
    // "Already started" is fine: the status below says where it is.
    if (!r.ok && r.status !== 400) return json({ error: r.error }, 502);
  }
  if (action === "qr") {
    const r = await call<{ qrCode?: string; status?: string }>(g, `${sessionPath(g)}/qr`);
    if (!r.ok)
      return json({
        qrCode: "",
        note:
          r.status === 400
            ? "No QR right now: the phone is already linked, or the instance is still starting. Press Check again in a few seconds."
            : r.error,
      });
    return json({ qrCode: String(r.data.qrCode ?? ""), status: String(r.data.status ?? "") });
  }
  if (action === "pairing") {
    const phone = String(body["phone"] ?? "").replace(/\D/g, "");
    const r = await call<{ pairingCode?: string }>(g, `${sessionPath(g)}/pairing-code`, {
      method: "POST",
      body: { phoneNumber: phone.length === 10 ? `91${phone}` : phone },
    });
    if (!r.ok) return json({ error: r.error }, 400);
    return json({ pairingCode: String(r.data.pairingCode ?? "") });
  }
  const s = await gatewaySession(g);
  if (!s.ok) return json({ error: s.error }, 502);
  return json(s);
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Delivery ticks (sent / delivered / read / failed) and phone status from the gateway. */
async function webhook(request: Request) {
  if (request.method !== "POST") return text("Method not allowed", 405);
  const raw = Buffer.from(await request.arrayBuffer());
  const g = await gatewayConfig();
  const secret = g.webhookSecret || (await gatewayConfig(true)).webhookSecret;
  const signature = request.headers.get("x-openwa-signature") ?? "";
  const expected = secret ? `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` : "";
  if (
    !expected ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return text("Invalid signature", 401);
  const body = JSON.parse(raw.toString("utf8") || "{}") as {
    event?: string;
    data?: Record<string, unknown>;
  };
  const data = body.data ?? {};
  const firestore = db();
  if (body.event === "message.ack" || body.event === "message.failed") {
    const providerId = String(data["messageId"] ?? data["id"] ?? "");
    const state = body.event === "message.failed" ? "failed" : String(data["status"] ?? "");
    if (!providerId || !(state in RANK) || state === "queued") return text("OK");
    const match = await firestore
      .collection("whatsappMessages")
      .where("providerMessageId", "==", providerId)
      .limit(1)
      .get();
    const doc = match.docs[0];
    if (!doc) return text("OK");
    await firestore.runTransaction(async (tx) => {
      const cur = await tx.get(doc.ref);
      const now = String(cur.data()?.["status"] ?? "queued");
      if (state !== "failed" && (RANK[state] ?? 0) <= (RANK[now] ?? 0)) return;
      tx.update(doc.ref, {
        status: state,
        [`${state}At`]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(state === "failed"
          ? { errorCode: "phone_failed", errorMessage: "WhatsApp did not deliver this message." }
          : {}),
      });
    });
  } else if (body.event === "session.status" || body.event === "session.disconnected") {
    const status =
      body.event === "session.disconnected" ? "disconnected" : String(data["status"] ?? "");
    if (status)
      await settingsRef().set(
        { gatewayStatus: status, gatewayCheckedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
  }
  return text("OK");
}

export function handleGateway(request: Request, action: string) {
  if (action === "gateway-webhook") return webhook(request);
  if (request.method !== "POST") return Promise.resolve(text("Method not allowed", 405));
  if (action === "gateway") return saveConnection(request);
  if (action === "gateway-status") return connectionAction(request);
  return Promise.resolve(text("Not found", 404));
}
