import { createHmac, timingSafeEqual } from "node:crypto";
import { getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";

const accessToken = defineSecret("WHATSAPP_ACCESS_TOKEN"),
  appSecret = defineSecret("WHATSAPP_APP_SECRET"),
  verifyToken = defineSecret("WHATSAPP_VERIFY_TOKEN");
const phoneNumberId = defineString("WHATSAPP_PHONE_NUMBER_ID", { default: "" }),
  graphVersion = defineString("WHATSAPP_GRAPH_API_VERSION", { default: "v23.0" });
const db = () => getFirestore(getApp());
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

/** Needed by any function that sends WhatsApp messages from the server (e.g. daily reminders). */
export const whatsappAccessToken = accessToken;

/** 10-digit Indian numbers get the country code; returns digits only, or "" when invalid. */
export function whatsappNumber(phone: string, countryCode = "91") {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `${countryCode.replace(/\D/g, "")}${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

/** Sends an approved template with body parameters. Used by server-side automations. */
export async function sendTemplateMessage(input: {
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
}): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string }> {
  if (!accessToken.value() || !phoneNumberId.value())
    return { ok: false, error: "WhatsApp Cloud API is not connected." };
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion.value()}/${phoneNumberId.value()}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.language || "en" },
          components: input.bodyParams.length
            ? [
                {
                  type: "body",
                  parameters: input.bodyParams.map((text) => ({ type: "text", text })),
                },
              ]
            : [],
        },
      }),
    },
  );
  const body = await response.text();
  if (!response.ok) return { ok: false, error: safeError(response.status, body) };
  const parsed = JSON.parse(body) as { messages?: Array<{ id?: string }> };
  return { ok: true, providerMessageId: String(parsed.messages?.[0]?.id ?? "") };
}

export const testWhatsAppConnection = onCall({ secrets: [accessToken] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (!accessToken.value() || !phoneNumberId.value())
    return { configured: false, detail: "WhatsApp credentials are not configured." };
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion.value()}/${phoneNumberId.value()}`,
    { headers: { Authorization: `Bearer ${accessToken.value()}` } },
  );
  return response.ok
    ? { configured: true, detail: "WhatsApp Cloud API is connected." }
    : { configured: false, detail: safeError(response.status, await response.text()) };
});

export const sendWhatsAppMessage = onCall({ secrets: [accessToken] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const messageId = String(req.data?.messageId ?? "");
  if (!messageId) throw new HttpsError("invalid-argument", "Message ID is required.");
  const ref = db().doc(`whatsappMessages/${messageId}`),
    snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Message request not found.");
  const data = snap.data() ?? {};
  if (["sent", "delivered", "read"].includes(String(data.status)))
    return { messageId, duplicate: true, status: data.status };
  if (!accessToken.value() || !phoneNumberId.value()) {
    await ref.update({
      status: "failed",
      failedAt: FieldValue.serverTimestamp(),
      errorCode: "not_configured",
      errorMessage: "WhatsApp Cloud API is not connected.",
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError("failed-precondition", "WhatsApp Cloud API is not connected.");
  }
  if (String(data.type) !== "test") {
    const client = await db()
      .doc(`clients/${String(data.clientId)}`)
      .get();
    if (!client.exists || client.data()?.whatsappOptIn !== true) {
      await ref.update({
        status: "failed",
        failedAt: FieldValue.serverTimestamp(),
        errorCode: "opt_in_required",
        errorMessage: "Client WhatsApp opt-in is required.",
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new HttpsError("failed-precondition", "Client WhatsApp opt-in is required.");
    }
  }
  const parameters = Array.isArray(req.data?.parameters)
    ? req.data.parameters.map((x: unknown) => ({ type: "text", text: String(x) }))
    : [];
  // The template's URL button is "https://<app>/invoice/{{1}}"; we fill in the bill's secret code,
  // so the member opens the bill page (view, download PDF, print).
  const buttonUrlParam = String(req.data?.buttonUrlParam ?? "");
  const components: Record<string, unknown>[] = [];
  if (parameters.length) components.push({ type: "body", parameters });
  if (buttonUrlParam)
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: buttonUrlParam }],
    });
  const payload = {
    messaging_product: "whatsapp",
    to: String(data.normalizedPhone),
    type: "template",
    template: {
      name: String(data.templateName),
      language: { code: String(data.templateLanguage || "en") },
      components,
    },
  };
  const response = await fetch(
      `https://graph.facebook.com/${graphVersion.value()}/${phoneNumberId.value()}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    ),
    body = await response.text();
  if (!response.ok) {
    const message = safeError(response.status, body);
    await ref.update({
      status: "failed",
      failedAt: FieldValue.serverTimestamp(),
      errorCode: String(response.status),
      errorMessage: message,
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError("internal", message);
  }
  const parsed = JSON.parse(body) as { messages?: Array<{ id?: string }> },
    providerMessageId = String(parsed.messages?.[0]?.id ?? "");
  await ref.update({
    status: "sent",
    providerMessageId,
    sentAt: FieldValue.serverTimestamp(),
    errorCode: "",
    errorMessage: "",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db()
    .doc(`clients/${String(data.clientId)}`)
    .set(
      {
        lastWhatsappMessageAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  return { messageId, providerMessageId, status: "sent" };
});

export const whatsappWebhook = onRequest(
  { secrets: [appSecret, verifyToken] },
  async (req, res) => {
    if (req.method === "GET") {
      if (
        req.query["hub.mode"] === "subscribe" &&
        req.query["hub.verify_token"] === verifyToken.value()
      ) {
        res.status(200).send(String(req.query["hub.challenge"] ?? ""));
        return;
      }
      res.status(403).send("Verification failed");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    const signature = req.header("x-hub-signature-256") ?? "",
      expected = `sha256=${createHmac("sha256", appSecret.value()).update(req.rawBody).digest("hex")}`;
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      res.status(401).send("Invalid signature");
      return;
    }
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          const providerId = String(status.id ?? ""),
            state = String(status.status ?? "");
          if (!providerId || !(state in rank)) continue;
          const eventId = `${providerId}_${state}`,
            eventRef = db().doc(`whatsappWebhookEvents/${eventId}`);
          await db().runTransaction(async (tx) => {
            if ((await tx.get(eventRef)).exists) return;
            tx.set(eventRef, {
              providerMessageId: providerId,
              status: state,
              receivedAt: FieldValue.serverTimestamp(),
            });
            const matches = await db()
              .collection("whatsappMessages")
              .where("providerMessageId", "==", providerId)
              .limit(1)
              .get();
            if (matches.empty) return;
            const target = matches.docs[0];
            if (!target) return;
            const current = String(target.data().status ?? "queued");
            if (state !== "failed" && (rank[state] ?? 0) < (rank[current] ?? 0)) return;
            const patch: Record<string, unknown> = {
              status: state,
              updatedAt: FieldValue.serverTimestamp(),
            };
            patch[`${state}At`] = FieldValue.serverTimestamp();
            if (state === "failed") {
              patch.errorCode = String(status.errors?.[0]?.code ?? "provider_failed");
              patch.errorMessage = String(status.errors?.[0]?.title ?? "WhatsApp delivery failed.");
            }
            tx.update(target.ref, patch);
          });
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  },
);
