import { formatPrice } from "@/lib/format";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import type { Invoice } from "@/types/models";

type ShareableInvoice = Pick<
  Invoice,
  "clientNameSnapshot" | "invoiceNumber" | "total" | "balanceDue" | "publicToken"
>;

/** The bill message staff send from their own WhatsApp. The link opens the bill with a PDF download. */
export function invoiceShareMessage(invoice: ShareableInvoice, businessName = "REBUILD FITNESS") {
  const balance = invoice.balanceDue > 0 ? ` Balance due: ${formatPrice(invoice.balanceDue)}.` : "";
  return (
    `Hi ${invoice.clientNameSnapshot}, thank you for joining ${businessName}! ` +
    `Your bill ${invoice.invoiceNumber} for ${formatPrice(invoice.total)} is ready.${balance}\n\n` +
    `View / download PDF: ${getInvoicePublicUrl(invoice)}`
  );
}

/**
 * wa.me link that opens WhatsApp (app or web) on the member's chat with the bill message
 * already typed — staff only press Send.
 */
export function manualWhatsAppUrl(
  invoice: ShareableInvoice & Pick<Invoice, "clientPhoneSnapshot">,
  countryCode = "91",
  businessName?: string,
) {
  const n = normalizeWhatsAppPhone(invoice.clientPhoneSnapshot, countryCode);
  const text = encodeURIComponent(invoiceShareMessage(invoice, businessName));
  return n.ok ? `https://wa.me/${n.value}?text=${text}` : `https://wa.me/?text=${text}`;
}
