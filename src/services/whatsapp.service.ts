import {
  doc,
  getDoc,
  orderBy,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, db } from "@/lib/firebase";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { invoicePdfUrl } from "@/lib/invoice-download";
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

type SendInput = {
  client: Pick<Client, "id" | "fullName" | "phone" | "whatsappPhone" | "whatsappOptIn">;
  type: WhatsAppMessageType;
  referenceId: string;
  templateName: string;
  templateLanguage?: string;
  parameters?: string[];
  /** Attached as the template's DOCUMENT header (e.g. the bill PDF). */
  headerDocument?: { link: string; filename: string } | null;
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
  if (input.type !== "test") {
    const clientSnap = await getDoc(doc(db, COLLECTIONS.clients, input.client.id));
    if (!clientSnap.exists()) throw new Error("Client record not found.");
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
    if (
      existing.exists() &&
      ["queued", "sent", "delivered", "read"].includes(String(existing.data()["status"]))
    )
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
        createdAt: existing.data()?.["createdAt"] ?? now,
        updatedAt: now,
      },
      { merge: true },
    );
    return true;
  });
  if (!claimed) return { duplicate: true, messageId: id };
  if (input.provider === "mock") return { duplicate: false, messageId: id };
  try {
    const call = httpsCallable(getFunctions(app), "sendWhatsAppMessage");
    await call({
      messageId: id,
      parameters: input.parameters ?? [],
      headerDocument: input.headerDocument ?? null,
    });
    return { duplicate: false, messageId: id };
  } catch (error) {
    await updateDoc(ref, {
      status: "failed",
      failedAt: serverTimestamp(),
      errorCode: "backend_unavailable",
      errorMessage: error instanceof Error ? error.message : "WhatsApp delivery failed",
      updatedAt: serverTimestamp(),
    });
    throw error;
  }
}

/**
 * Sends a bill through the WhatsApp Cloud API with the PDF attached (when the approved
 * template has a document header). Generates the PDF first if it is missing.
 */
export async function sendInvoiceWhatsApp(
  invoice: Invoice,
  wa: WhatsAppSettings,
  business: BusinessBillingSettings,
) {
  if (wa.mode !== "whatsapp")
    throw new Error("WhatsApp API is not connected. Use Share on WhatsApp instead.");
  const pdfUrl = invoice.pdfUrl || invoicePdfUrl(invoice.publicToken);
  const result = await sendWhatsAppMessage({
    client: {
      id: invoice.clientId,
      fullName: invoice.clientNameSnapshot,
      phone: invoice.clientPhoneSnapshot,
      whatsappPhone: invoice.clientPhoneSnapshot,
      whatsappOptIn: true,
    },
    type: "invoice",
    referenceId: invoice.id,
    templateName: wa.invoiceTemplate,
    templateLanguage: wa.templateLanguage,
    // Order must match the approved "gym_bill" template: name, gym, bill no., paid, balance, link.
    parameters: [
      invoice.clientNameSnapshot,
      business.businessName || "our gym",
      invoice.invoiceNumber,
      invoice.amountPaid.toLocaleString("en-IN"),
      invoice.balanceDue.toLocaleString("en-IN"),
      getInvoicePublicUrl(invoice),
    ],
    headerDocument: wa.invoiceAttachPdf
      ? { link: pdfUrl, filename: `${invoice.invoiceNumber}.pdf` }
      : null,
    messagePreview: invoiceShareMessage(invoice, business.businessName),
    provider: wa.mode,
  });
  await markInvoiceShared(invoice);
  return result;
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
  const call = httpsCallable(getFunctions(app), "testWhatsAppConnection");
  return (await call({})).data as { configured: boolean; detail: string };
}
