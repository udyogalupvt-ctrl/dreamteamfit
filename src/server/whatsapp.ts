/**
 * WhatsApp Cloud API, called only from the server so the access token never reaches a browser.
 *
 *   POST /api/whatsapp/send      staff: send a queued whatsappMessages doc (bill, test)
 *   POST /api/whatsapp/test      staff: check the token and phone number
 *   GET  /api/whatsapp/webhook   Meta verification
 *   POST /api/whatsapp/webhook   delivery ticks (sent / delivered / read / failed) and members'
 *                                messages (WhatsApp chats, src/server/whatsapp-chat.ts)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, json, requireStaff, text } from "./admin";
import { gatewayConfig, gatewayTest, handleGateway, sendFromPhone } from "./whatsapp-gateway";
import { chatStatus, handleChat, receiveMessages, recordOutgoing } from "./whatsapp-chat";

const env = (k: string, fallback = "") => (process.env[k] ?? fallback).trim();
const config = () => ({
  token: env("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
  version: env("WHATSAPP_GRAPH_API_VERSION", "v23.0"),
  // Only changed for local tests (a fake WhatsApp server), never in production.
  base: env("WHATSAPP_GRAPH_BASE", "https://graph.facebook.com"),
});
const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

const safeError = (status: number, body: string) =>
  status === 401
    ? "WhatsApp credentials were rejected."
    : status === 429
      ? "WhatsApp rate limit reached. Try again later."
      : status >= 500
        ? "WhatsApp is temporarily unavailable."
        : body.includes("template")
          ? "The approved WhatsApp template is unavailable or invalid."
          : "WhatsApp could not send this message.";

/** 10-digit Indian numbers get the country code; returns digits only, or "" when invalid. */
export function whatsappNumber(phone: string, countryCode = "91") {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const cc = countryCode.replace(/\D/g, "");
  if (digits.length === 10) digits = `${/^\d{1,3}$/.test(cc) ? cc : "91"}${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

/**
 * Sends a message. With the Meta Cloud API: the approved template (`buttonUrlParam` fills its URL
 * button {{1}}). From the gym's own number (Settings → WhatsApp → linked phone): the same values
 * as text, with the link written in (`kind` picks the wording: invoice, renewal, …).
 */
export async function sendTemplateMessage(input: {
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
  buttonUrlParam?: string;
  kind?: string;
  /** "phone": from the gym's own number even while Send from is the Cloud API (Settings test). */
  via?: "phone";
  /** The message as the member reads it, for the member's WhatsApp chat in the app. */
  preview?: string;
}): Promise<
  | { ok: true; providerMessageId: string; provider: "whatsapp" | "phone" }
  | { ok: false; error: string; code: string }
> {
  if (input.via === "phone" || (await gatewayConfig()).sender === "phone") {
    const r = await sendFromPhone({
      to: input.to,
      kind: input.kind ?? "",
      bodyParams: input.bodyParams,
      buttonUrlParam: input.buttonUrlParam ?? "",
    });
    return r.ok ? { ...r, provider: "phone" } : r;
  }
  const c = config();
  if (!c.token || !c.phoneNumberId)
    return { ok: false, error: "WhatsApp Cloud API is not connected.", code: "not_configured" };
  const components: Record<string, unknown>[] = [];
  if (input.bodyParams.length)
    components.push({
      type: "body",
      // WhatsApp refuses line breaks, tabs and long runs of spaces inside a value.
      parameters: input.bodyParams.map((t) => ({
        type: "text",
        text: t.replace(/\s+/g, " ").trim() || "-",
      })),
    });
  if (input.buttonUrlParam)
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: input.buttonUrlParam }],
    });
  const response = await fetch(`${c.base}/${c.version}/${c.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language || "en" },
        components,
      },
    }),
  });
  const body = await response.text();
  if (!response.ok)
    return { ok: false, error: safeError(response.status, body), code: String(response.status) };
  const parsed = JSON.parse(body) as { messages?: Array<{ id?: string }> };
  const providerMessageId = String(parsed.messages?.[0]?.id ?? "");
  await recordOutgoing({
    waId: input.to,
    wamid: providerMessageId,
    text: input.preview || input.bodyParams.join(" · ") || input.templateName,
    template: input.templateName,
  });
  return { ok: true, providerMessageId, provider: "whatsapp" };
}

/** Server-only note of Meta's delivery reports (accepted / refused), never message content. */
const webhookStatus = () => db().doc("whatsappWebhookStatus/meta");

/**
 * Delivery ticks need two things on Meta's side: the business account subscribed to this app
 * (switched on here when it isn't) and reports signed with the App secret the server has.
 */
async function deliveryTicks(c: ReturnType<typeof config>) {
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!waba) return " Delivery ticks: can't check (business account ID not set on the server).";
  const auth = { Authorization: `Bearer ${c.token}` };
  let note = "";
  const list = await fetch(`${c.base}/${c.version}/${waba}/subscribed_apps`, { headers: auth });
  const apps = list.ok
    ? (((await list.json()) as { data?: { whatsapp_business_api_data?: { id?: string } }[] })
        .data ?? [])
    : null;
  // The app the WhatsApp key belongs to (the one whose webhook was set up in Meta).
  const me = (await fetch(`${c.base}/${c.version}/app`, { headers: auth })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { id?: string } | null;
  const mine = me?.id
    ? !!apps?.some((a) => a.whatsapp_business_api_data?.id === me.id)
    : !!apps?.length;
  if (!apps) note = ` Delivery ticks: couldn't check (${list.status}).`;
  else if (!mine) {
    const sub = await fetch(`${c.base}/${c.version}/${waba}/subscribed_apps`, {
      method: "POST",
      headers: auth,
    });
    note = sub.ok
      ? " Delivery ticks switched on: send a message to see them."
      : ` Delivery ticks: couldn't switch on (${sub.status}).`;
  } else note = " Delivery ticks: on.";
  const st = (await webhookStatus().get()).data() ?? {};
  const t = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  if (t(st["rejectedAt"]) > t(st["acceptedAt"]))
    note +=
      st["rejectedReason"] === "no-secret"
        ? " Meta's reports are refused: the App secret isn't set on Vercel (WHATSAPP_APP_SECRET), then Redeploy."
        : " Meta's reports are refused: the App secret on Vercel doesn't match Meta's. Copy it again (Meta → App settings → Basic → App secret) into WHATSAPP_APP_SECRET, then Redeploy.";
  return note;
}

async function testConnection(request: Request) {
  if (!(await requireStaff(request))) return json({ error: "Sign in required." }, 401);
  if ((await gatewayConfig(true)).sender === "phone") return json(await gatewayTest());
  const c = config();
  if (!c.token || !c.phoneNumberId)
    return json({ configured: false, detail: "WhatsApp credentials are not set on the server." });
  const response = await fetch(`${c.base}/${c.version}/${c.phoneNumberId}`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  if (!response.ok)
    return json({ configured: false, detail: safeError(response.status, await response.text()) });
  const ticks = await deliveryTicks(c).catch(() => " Delivery ticks: couldn't check.");
  return json({
    configured: true,
    detail: `WhatsApp Cloud API is connected.${ticks}`,
    // Something to fix for the ticks: shown as a warning, not a success.
    warn: /couldn't|can't|refused/.test(ticks),
  });
}

async function send(request: Request) {
  if (!(await requireStaff(request))) return json({ error: "Sign in required." }, 401);
  const input = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    parameters?: unknown[];
    buttonUrlParam?: string;
    via?: string;
  };
  const messageId = String(input.messageId ?? "");
  if (!messageId) return json({ error: "Message ID is required." }, 400);
  const ref = db().doc(`whatsappMessages/${messageId}`);
  // Claim the message in a transaction: two taps / two screens at the same moment can never
  // both send it. A claim older than 2 minutes (a crashed send) may be taken over.
  const claim = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { kind: "missing" as const };
    const d = s.data() ?? {};
    if (["sent", "delivered", "read"].includes(String(d["status"])))
      return { kind: "done" as const, status: String(d["status"]) };
    const claimedAt =
      (d["sendClaimedAt"] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    if (Date.now() - claimedAt < 120_000) return { kind: "busy" as const };
    tx.update(ref, { sendClaimedAt: FieldValue.serverTimestamp() });
    return { kind: "claimed" as const, data: d };
  });
  if (claim.kind === "missing") return json({ error: "Message request not found." }, 404);
  if (claim.kind === "done") return json({ messageId, duplicate: true, status: claim.status });
  if (claim.kind === "busy") return json({ messageId, duplicate: true, status: "sending" });
  const data = claim.data;

  const fail = async (code: string, message: string, status: number) => {
    await ref.update({
      status: "failed",
      failedAt: FieldValue.serverTimestamp(),
      errorCode: code,
      errorMessage: message,
      // Released, so staff can press Retry.
      sendClaimedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return json({ error: message }, status);
  };
  // Tests, and numbers staff typed on the Announcements page, have no member to check.
  const typedNumber = String(data["type"]) === "announcement" && !data["clientId"];
  if (String(data["type"]) !== "test" && !typedNumber) {
    const client = await db()
      .doc(`clients/${String(data["clientId"])}`)
      .get();
    if (!client.exists || client.data()?.["whatsappOptIn"] !== true)
      return fail("opt_in_required", "Client WhatsApp opt-in is required.", 412);
  }
  const result = await sendTemplateMessage({
    to: String(data["normalizedPhone"]),
    templateName: String(data["templateName"]),
    language: String(data["templateLanguage"] || "en"),
    bodyParams: Array.isArray(input.parameters) ? input.parameters.map(String) : [],
    // The template's URL button is "https://<app>/invoice/{{1}}": the bill's secret code goes
    // in, so the member opens their bill page (view, download PDF, print).
    buttonUrlParam: String(input.buttonUrlParam ?? ""),
    kind: String(data["type"] ?? ""),
    preview: String(data["messagePreview"] ?? ""),
    // Only a test may try the gym's own number before it is chosen in Send from.
    ...(input.via === "phone" && String(data["type"]) === "test" ? { via: "phone" as const } : {}),
  });
  if (!result.ok)
    return fail(result.code, result.error, result.code === "not_configured" ? 412 : 502);
  await ref.update({
    status: "sent",
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    sentAt: FieldValue.serverTimestamp(),
    errorCode: "",
    errorMessage: "",
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (data["clientId"])
    await db()
      .doc(`clients/${String(data["clientId"])}`)
      .set(
        {
          lastWhatsappMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  return json({ messageId, providerMessageId: result.providerMessageId, status: "sent" });
}

async function webhook(request: Request, url: URL) {
  if (request.method === "GET") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      !!env("WHATSAPP_VERIFY_TOKEN") &&
      url.searchParams.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN");
    return ok
      ? text(url.searchParams.get("hub.challenge") ?? "")
      : text("Verification failed", 403);
  }
  if (request.method !== "POST") return text("Method not allowed", 405);
  const raw = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", env("WHATSAPP_APP_SECRET")).update(raw).digest("hex")}`;
  if (
    !env("WHATSAPP_APP_SECRET") ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    // Meta did call but the App secret doesn't match (or isn't set): noted for "Test connection".
    await webhookStatus()
      .set(
        {
          rejectedAt: FieldValue.serverTimestamp(),
          rejectedReason: env("WHATSAPP_APP_SECRET") ? "signature" : "no-secret",
          rejected: FieldValue.increment(1),
        },
        { merge: true },
      )
      .catch(() => undefined);
    return text("Invalid signature", 401);
  }
  await webhookStatus()
    .set(
      { acceptedAt: FieldValue.serverTimestamp(), accepted: FieldValue.increment(1) },
      { merge: true },
    )
    .catch(() => undefined);
  let body: {
    entry?: Array<{
      changes?: Array<{
        value?: Parameters<typeof receiveMessages>[0] & {
          statuses?: Array<Record<string, unknown>>;
        };
      }>;
    }>;
  };
  try {
    body = JSON.parse(raw.toString("utf8") || "{}") as typeof body;
  } catch {
    return text("Bad request", 400);
  }
  const firestore = db();
  for (const entry of body.entry ?? [])
    for (const change of entry.changes ?? []) {
      // Members' messages for WhatsApp chats.
      if (change.value?.messages?.length) await receiveMessages(change.value);
      for (const status of change.value?.statuses ?? []) {
        const providerId = String(status["id"] ?? "");
        const state = String(status["status"] ?? "");
        if (!providerId || !(state in rank)) continue;
        const errs = status["errors"] as Array<{ title?: unknown }> | undefined;
        await chatStatus(
          String(status["recipient_id"] ?? ""),
          providerId,
          state,
          state === "failed" ? String(errs?.[0]?.title ?? "") : undefined,
        ).catch(() => undefined);
        const eventRef = firestore.doc(`whatsappWebhookEvents/${providerId}_${state}`);
        const matches = await firestore
          .collection("whatsappMessages")
          .where("providerMessageId", "==", providerId)
          .limit(1)
          .get();
        await firestore.runTransaction(async (tx) => {
          if ((await tx.get(eventRef)).exists) return;
          const target = matches.docs[0] ? await tx.get(matches.docs[0].ref) : null;
          tx.set(eventRef, {
            providerMessageId: providerId,
            status: state,
            receivedAt: FieldValue.serverTimestamp(),
          });
          if (!target?.exists) return;
          const current = String(target.data()?.["status"] ?? "queued");
          if (state !== "failed" && (rank[state] ?? 0) < (rank[current] ?? 0)) return;
          const errors = status["errors"] as Array<{ code?: unknown; title?: unknown }> | undefined;
          tx.update(target.ref, {
            status: state,
            [`${state}At`]: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            ...(state === "failed"
              ? {
                  errorCode: String(errors?.[0]?.code ?? "provider_failed"),
                  errorMessage: String(errors?.[0]?.title ?? "WhatsApp delivery failed."),
                }
              : {}),
          });
        });
      }
    }
  return text("EVENT_RECEIVED");
}

/** Approved templates with their Meta category (Utility / Marketing), for the usage page. */
async function templates(request: Request) {
  if (!(await requireStaff(request))) return json({ error: "Sign in required." }, 401);
  const c = config();
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!c.token || !waba) return json({ templates: [] });
  const r = await fetch(
    `https://graph.facebook.com/${c.version}/${waba}/message_templates?fields=name,status,category&limit=100`,
    { headers: { Authorization: `Bearer ${c.token}` } },
  );
  if (!r.ok) return json({ templates: [] });
  const body = (await r.json()) as { data?: { name: string; status: string; category: string }[] };
  return json({
    templates: (body.data ?? []).map((t) => ({
      name: t.name,
      status: t.status,
      category: t.category,
    })),
  });
}

export function handleWhatsApp(request: Request, url: URL) {
  const action = url.pathname.replace(/^\/api\/whatsapp\/?/, "").replace(/\/+$/, "");
  if (action === "webhook") return webhook(request, url);
  if (action.startsWith("gateway")) return handleGateway(request, action);
  if (action.startsWith("chat/")) return handleChat(request, url, action);
  if (action === "templates" && request.method === "GET") return templates(request);
  if (request.method !== "POST") return text("Method not allowed", 405);
  if (action === "send") return send(request);
  if (action === "test") return testConnection(request);
  return text("Not found", 404);
}
