import {
  doc,
  getDoc,
  orderBy,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { callServer } from "@/lib/server-api";
import { invoiceShareMessage } from "@/lib/invoice-share";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import type {
  BusinessBillingSettings,
  Client,
  CommunicationProviderName,
  Invoice,
  WhatsAppMessage,
  WhatsAppMessageType,
  WhatsAppSettings,
} from "@/types/models";
import { COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";
import { getBusinessSettings } from "./business-settings.service";
import { mapInvoice } from "./invoices.service";
import { getWhatsAppSettings, isWhatsAppApiLive } from "./whatsapp-settings.service";

type SendInput = {
  client: Pick<Client, "id" | "fullName" | "phone" | "whatsappPhone" | "whatsappOptIn">;
  type: WhatsAppMessageType;
  referenceId: string;
  templateName: string;
  templateLanguage?: string;
  parameters?: string[];
  /** Fills the {{1}} at the end of the template's URL button (the bill's secret code). */
  buttonUrlParam?: string;
  messagePreview: string;
  provider: CommunicationProviderName;
};

const safeId = (x: string) => x.replace(/[^a-zA-Z0-9_-]/g, "_");

export const mapWhatsAppMessage = (id: string, d: DocumentData): WhatsAppMessage => ({
  id,
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  phoneSnapshot: d["phoneSnapshot"] ?? "",
  normalizedPhone: d["normalizedPhone"] ?? "",
  type: d["type"] ?? "follow_up",
  referenceId: d["referenceId"] ?? "",
  provider: d["provider"] ?? "mock",
  templateName: d["templateName"] ?? "",
  templateLanguage: d["templateLanguage"] ?? "en",
  messagePreview: d["messagePreview"] ?? "",
  status: d["status"] ?? "queued",
  providerMessageId: d["providerMessageId"] ?? "",
  sentAt: d["sentAt"] ? toDate(d["sentAt"]) : null,
  deliveredAt: d["deliveredAt"] ? toDate(d["deliveredAt"]) : null,
  readAt: d["readAt"] ? toDate(d["readAt"]) : null,
  failedAt: d["failedAt"] ? toDate(d["failedAt"]) : null,
  errorCode: d["errorCode"] ?? "",
  errorMessage: d["errorMessage"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeWhatsAppMessages = (
  ok: (x: WhatsAppMessage[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeCollection(
    COLLECTIONS.whatsappMessages,
    mapWhatsAppMessage,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );

export async function sendWhatsAppMessage(input: SendInput) {
  let recipient = input.client;
  // A number typed on the Announcements page has no member record to check.
  const typedNumber = input.type === "announcement" && !input.client.id;
  if (input.type !== "test" && !typedNumber) {
    const clientSnap = await getDoc(doc(db, COLLECTIONS.clients, input.client.id));
    if (!clientSnap.exists()) throw new Error("Member record not found.");
    const data = clientSnap.data();
    recipient = {
      ...input.client,
      phone: String(data["phone"] ?? input.client.phone),
      whatsappPhone: String(data["whatsappPhone"] || data["phone"] || input.client.phone),
      whatsappOptIn: Boolean(data["whatsappOptIn"]),
    };
    if (!recipient.whatsappOptIn)
      throw new Error(
        "This member said no to WhatsApp messages. Turn on WhatsApp in their profile, or use Share on WhatsApp.",
      );
  }
  const normalized = normalizeWhatsAppPhone(recipient.whatsappPhone || recipient.phone);
  if (!normalized.ok) throw new Error(normalized.error);
  const id = safeId(`${input.type}__${input.referenceId}`),
    ref = doc(db, COLLECTIONS.whatsappMessages, id);
  const claimed = await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    const d = existing.data();
    // "queued" that the server never picked up (the phone / tab closed right after the claim)
    // may be tried again after 2 minutes. Once the server has claimed it, the server decides.
    const stuck =
      d?.["status"] === "queued" &&
      !d["sendClaimedAt"] &&
      Date.now() - ((d["updatedAt"] as { toMillis?: () => number } | null)?.toMillis?.() ?? 0) >
        120_000;
    if (d && ["queued", "sent", "delivered", "read"].includes(String(d["status"])) && !stuck)
      return false;
    const now = serverTimestamp();
    tx.set(
      ref,
      {
        clientId: recipient.id,
        clientNameSnapshot: recipient.fullName,
        phoneSnapshot: recipient.whatsappPhone || recipient.phone,
        normalizedPhone: normalized.value,
        type: input.type,
        referenceId: input.referenceId,
        provider: input.provider,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage ?? "en",
        messagePreview: input.messagePreview,
        status: "queued",
        providerMessageId: "",
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        errorCode: "",
        errorMessage: "",
        createdAt: d?.["createdAt"] ?? now,
        updatedAt: now,
      },
      { merge: true },
    );
    return true;
  });
  if (!claimed) return { duplicate: true, messageId: id };
  if (input.provider === "mock") return { duplicate: false, messageId: id };
  try {
    await callServer("/api/whatsapp/send", {
      messageId: id,
      parameters: input.parameters ?? [],
      buttonUrlParam: input.buttonUrlParam ?? "",
    });
    return { duplicate: false, messageId: id };
  } catch (error) {
    // Only a message that never went out becomes "failed". If the server already sent it (and
    // just the reply was lost), it stays "sent", so a Retry can never send it twice.
    await runTransaction(db, async (tx) => {
      const now = await tx.get(ref);
      if (now.data()?.["status"] !== "queued") return;
      tx.update(ref, {
        status: "failed",
        failedAt: serverTimestamp(),
        errorCode: "backend_unavailable",
        errorMessage: error instanceof Error ? error.message : "WhatsApp delivery failed",
        updatedAt: serverTimestamp(),
      });
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * Sends the bill through the WhatsApp Cloud API ("gym_payment_receipt" template). The template's
 * "View bill" button opens the bill page, where the member can view, download or print it.
 * Each payment state is sent once, so after collecting a balance the updated bill can go again.
 */
export async function sendInvoiceWhatsApp(
  invoice: Invoice,
  wa: WhatsAppSettings,
  business: BusinessBillingSettings,
) {
  if (wa.mode !== "whatsapp")
    throw new Error("WhatsApp API is not connected. Use Share on WhatsApp instead.");
  const result = await sendWhatsAppMessage({
    client: {
      id: invoice.clientId,
      fullName: invoice.clientNameSnapshot,
      phone: invoice.clientPhoneSnapshot,
      whatsappPhone: invoice.clientPhoneSnapshot,
      whatsappOptIn: true,
    },
    type: "invoice",
    referenceId: `${invoice.id}_${invoice.amountPaid}`,
    templateName: wa.invoiceTemplate,
    templateLanguage: wa.templateLanguage,
    // Order must match the approved "gym_payment_receipt" template: name, gym, bill no., paid, balance.
    parameters: [
      invoice.clientNameSnapshot,
      business.businessName || "our gym",
      invoice.invoiceNumber,
      invoice.amountPaid.toLocaleString("en-IN"),
      invoice.balanceDue.toLocaleString("en-IN"),
    ],
    buttonUrlParam: invoice.publicToken,
    messagePreview: invoiceShareMessage(invoice, business.businessName),
    provider: wa.mode,
  });
  await markInvoiceShared(invoice);
  return result;
}

export type AutoSendResult =
  | { kind: "sent" }
  | { kind: "already_sent" }
  | { kind: "off" }
  | { kind: "no_opt_in" }
  | { kind: "failed"; message: string };

/**
 * Call after ANY money is collected (joining, balance, shop bill). Sends the updated bill
 * through the WhatsApp Cloud API when the API and "Send the bill automatically" are on and the
 * member agreed to WhatsApp. Each payment state is sent once (see sendInvoiceWhatsApp).
 */
export async function autoSendBill(invoiceId: string): Promise<AutoSendResult> {
  const [invoiceSnap, wa, business] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.invoices, invoiceId)),
    getWhatsAppSettings(),
    getBusinessSettings(),
  ]);
  if (!invoiceSnap.exists()) return { kind: "failed", message: "Bill not found." };
  if (!isWhatsAppApiLive(wa) || !wa.autoSendInvoice) return { kind: "off" };
  const invoice = mapInvoice(invoiceSnap.id, invoiceSnap.data());
  const client = await getDoc(doc(db, COLLECTIONS.clients, invoice.clientId));
  if (!client.exists() || client.data()["whatsappOptIn"] !== true) return { kind: "no_opt_in" };
  try {
    const r = await sendInvoiceWhatsApp(invoice, wa, business);
    return r.duplicate ? { kind: "already_sent" } : { kind: "sent" };
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Records that the bill reached the member so a resumed enrollment skips the share step. */
export async function markInvoiceShared(invoice: Pick<Invoice, "enrollmentId">) {
  if (!invoice.enrollmentId) return;
  await updateDoc(doc(db, COLLECTIONS.enrollments, invoice.enrollmentId), {
    invoiceSharedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function testWhatsAppConnection() {
  return callServer<{ configured: boolean; detail: string }>("/api/whatsapp/test");
}
