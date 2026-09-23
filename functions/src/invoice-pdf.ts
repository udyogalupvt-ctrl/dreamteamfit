/**
 * Bill PDF served from the bill's secret public link, so no file storage is needed:
 *   GET /invoicePdf?t=<publicToken>  →  application/pdf
 * WhatsApp fetches this URL for the document header of the bill template.
 * Mirrors the layout of src/lib/invoice-pdf.ts (the in-browser version).
 */
import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type Item = {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
};
type Business = {
  businessName?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  taxRate?: number;
};
type PublicBill = {
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  items: Item[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
  paymentMethod: string;
  invoiceDate: string;
  dueDate: string;
  business: Business;
};

const A4: [number, number] = [595.28, 841.89],
  M = 44,
  YELLOW = rgb(0.96, 0.82, 0.02),
  CHARCOAL = rgb(0.09, 0.09, 0.08),
  GRAY = rgb(0.4, 0.4, 0.38),
  LINE = rgb(0.87, 0.87, 0.84);
const money = (n: number) =>
  `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}`;
const clean = (value: string) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ");
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of clean(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function renderBillPdf(bill: PublicBill) {
  const business = bill.business ?? {};
  const gym = business.businessName || "REBUILD FITNESS";
  const pdf = await PDFDocument.create(),
    normal = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage(A4),
    y = A4[1] - M;
  const text = (v: string, x: number, yy: number, size = 9, font = normal, color = CHARCOAL) =>
    page.drawText(clean(v), { x, y: yy, size, font, color });
  const band = () =>
    page.drawRectangle({ x: 0, y: A4[1] - 18, width: A4[0], height: 18, color: YELLOW });
  const addPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - M;
    band();
  };
  const footer = () => {
    page.drawLine({
      start: { x: M, y: 42 },
      end: { x: A4[0] - M, y: 42 },
      thickness: 1,
      color: LINE,
    });
    text(`Thank you for choosing ${gym}.`, M, 27, 8, bold);
    const contact = [business.phone, business.email].filter(Boolean).join(" | ");
    if (contact) text(contact, A4[0] - M - bold.widthOfTextAtSize(clean(contact), 8), 27, 8, bold);
  };
  band();
  let titleX = M;
  if (business.logoUrl) {
    try {
      const bytes = await fetch(business.logoUrl).then((r) => r.arrayBuffer());
      const logo =
        new Uint8Array(bytes)[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      page.drawImage(logo, { x: M, y: y - 3, width: 34, height: 34 });
      titleX = M + 44;
    } catch {
      /* name only */
    }
  }
  text(gym, titleX, y + 4, 22, bold);
  text("INVOICE", A4[0] - M - bold.widthOfTextAtSize("INVOICE", 22), y, 22, bold);
  y -= 24;
  for (const line of wrap(
    [
      business.address,
      business.phone,
      business.email,
      business.gstin ? `GSTIN: ${business.gstin}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    normal,
    8,
    330,
  )) {
    text(line, M, y, 8, normal, GRAY);
    y -= 11;
  }
  y -= 16;
  text(`Invoice Number: ${bill.invoiceNumber}`, M, y, 10, bold);
  text(`Invoice Date: ${bill.invoiceDate}`, 350, y, 9);
  y -= 16;
  text(`Due Date: ${bill.dueDate}`, 350, y, 9);
  y -= 28;
  page.drawRectangle({
    x: M,
    y: y - 52,
    width: A4[0] - 2 * M,
    height: 62,
    color: rgb(0.97, 0.97, 0.95),
  });
  text("BILL TO", M + 12, y - 14, 8, bold, GRAY);
  text(bill.clientName, M + 12, y - 31, 12, bold);
  text(
    [bill.clientPhone, bill.clientEmail].filter(Boolean).join(" | "),
    M + 12,
    y - 46,
    8,
    normal,
    GRAY,
  );
  y -= 82;
  const header = () => {
    page.drawRectangle({ x: M, y: y - 22, width: A4[0] - 2 * M, height: 26, color: CHARCOAL });
    text("ITEM", M + 8, y - 14, 8, bold, rgb(1, 1, 1));
    text("QTY", 355, y - 14, 8, bold, rgb(1, 1, 1));
    text("RATE", 407, y - 14, 8, bold, rgb(1, 1, 1));
    text("AMOUNT", 489, y - 14, 8, bold, rgb(1, 1, 1));
    y -= 30;
  };
  header();
  for (const item of bill.items ?? []) {
    const lines = wrap(
      item.description ? `${item.name} - ${item.description}` : item.name,
      normal,
      9,
      290,
    );
    const h = Math.max(28, lines.length * 12 + 12);
    if (y - h < 120) {
      footer();
      addPage();
      header();
    }
    lines.forEach((line, i) => text(line, M + 8, y - 12 - i * 12, 9, i === 0 ? bold : normal));
    text(String(item.quantity), 360, y - 12, 9);
    text(money(item.unitPrice), 407, y - 12, 9);
    text(money(item.total), 489, y - 12, 9);
    page.drawLine({
      start: { x: M, y: y - h },
      end: { x: A4[0] - M, y: y - h },
      thickness: 0.6,
      color: LINE,
    });
    y -= h;
  }
  if (y < 230) {
    footer();
    addPage();
  }
  y -= 18;
  const rows: [string, number][] = [
    ["Subtotal", bill.subtotal],
    ["Discount", bill.discount ? -bill.discount : 0],
    ...(bill.tax > 0 ? [[`Tax (${business.taxRate ?? 0}%)`, bill.tax] as [string, number]] : []),
    ["Total", bill.total],
    ["Amount Paid", bill.amountPaid],
    ["Balance Due", bill.balanceDue],
  ];
  for (const [label, value] of rows) {
    const f = label === "Total" || label === "Balance Due" ? bold : normal;
    text(label, 350, y, 9, f);
    const v = money(value);
    text(v, A4[0] - M - f.widthOfTextAtSize(v, 9), y, 9, f);
    y -= 17;
  }
  y -= 12;
  text(
    `Payment: ${bill.paymentMethod} | ${String(bill.paymentStatus).toUpperCase()}`,
    350,
    y,
    9,
    bold,
  );
  pdf.getPages().forEach((p) => {
    page = p;
    footer();
  });
  return pdf.save();
}

export const invoicePdf = onRequest({ memory: "256MiB", cors: true }, async (req, res) => {
  const token = String(req.query["t"] ?? "");
  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    res.status(400).send("Invalid bill link");
    return;
  }
  try {
    const snap = await getFirestore(getApp()).doc(`publicInvoices/${token}`).get();
    if (!snap.exists) {
      res.status(404).send("Bill not found");
      return;
    }
    const bill = snap.data() as PublicBill;
    const bytes = await renderBillPdf(bill);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="${clean(bill.invoiceNumber) || "bill"}.pdf"`);
    res.set("Cache-Control", "private, max-age=300");
    res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    logger.error("invoicePdf failed", { error: String(error) });
    res.status(500).send("Could not create the PDF");
  }
});
