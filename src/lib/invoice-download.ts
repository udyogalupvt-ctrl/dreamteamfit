import { generateInvoicePdf } from "@/lib/invoice-pdf";
import type { BusinessBillingSettings, Invoice, PublicInvoice } from "@/types/models";

/**
 * Builds the bill PDF in the browser and saves it. Needs no file storage, so it works for staff
 * and for members opening their bill link.
 */
export async function downloadInvoicePdf(
  invoice: Invoice | PublicInvoice,
  business: BusinessBillingSettings,
) {
  const bytes = await generateInvoicePdf(invoice, business);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.invoiceNumber || "bill"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
