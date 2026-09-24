/**
 * WhatsApp Cloud API, called only from the server so the access token never reaches a browser.
 *
 *   POST /api/whatsapp/send      staff: send a queued whatsappMessages doc (bill, test)
 *   POST /api/whatsapp/test      staff: check the token and phone number
 *   GET  /api/whatsapp/webhook   Meta verification
 *   POST /api/whatsapp/webhook   delivery ticks (sent / delivered / read / failed)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, json, requireStaff, text } from "./admin";

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

/** Sends an approved template. `buttonUrlParam` fills a dynamic URL button ({{1}}). */
export async function sendTemplateMessage(input: {
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
  buttonUrlParam?: string;
}): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string; code: string }> {
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
  return { ok: true, providerMessageId: String(parsed.messages?.[0]?.id ?? "") };
}

async function testConnection(request: Request) {
  if (!(await requireStaff(request))) return json({ error: "Sign in required." }, 401);
  const c = config();
  if (!c.token || !c.phoneNumberId)
    return json({ configured: false, detail: "WhatsApp credentials are not set on the server." });
  const response = await fetch(`${c.base}/${c.version}/${c.phoneNumberId}`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  return json(
    response.ok
      ? { configured: true, detail: "WhatsApp Cloud API is connected." }
      : { configured: false, detail: safeError(response.status, await response.text()) },
  );
}

async function send(request: Request) {
  if (!(await requireStaff(request))) return json({ error: "Sign in required." }, 401);
  const input = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    parameters?: unknown[];
    buttonUrlParam?: string;
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
  });
  if (!result.ok)
    return fail(result.code, result.error, result.code === "not_configured" ? 412 : 502);
  await ref.update({
    status: "sent",
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
  )
    return text("Invalid signature", 401);
  const body = JSON.parse(raw.toString("utf8") || "{}") as {
    entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<Record<string, unknown>> } }> }>;
  };
  const firestore = db();
  for (const entry of body.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const status of change.value?.statuses ?? []) {
        const providerId = String(status["id"] ?? "");
        const state = String(status["status"] ?? "");
        if (!providerId || !(state in rank)) continue;
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
  if (action === "templates" && request.method === "GET") return templates(request);
  if (request.method !== "POST") return text("Method not allowed", 405);
  if (action === "send") return send(request);
  if (action === "test") return testConnection(request);
  return text("Not found", 404);
}
