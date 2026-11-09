/**
 * The printable poster for an anonymous feedback QR (browser only). Drawn on a canvas at A4,
 * 150 dpi (1240 × 1754), then saved as PNG, put in an A4 PDF, or sent to the printer. The QR is
 * black on white with a wide quiet zone and high error correction, so a scuffed print still scans.
 */
import { encode } from "uqr";

export type PosterInput = { url: string; gymName: string; place: string; logoUrl?: string };

const W = 1240;
const H = 1754;
const INK = "#111111";
// The app's brand yellow (--primary, oklch(0.88 0.19 101)).
const BRAND = "#E1D826";
const DISPLAY = '"Outfit", "Segoe UI", Arial, sans-serif';
const SANS = '"Plus Jakarta Sans", "Segoe UI", Arial, sans-serif';

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "qr";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    // Without CORS the logo is skipped (a "tainted" canvas could not be saved).
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 6000);
  });
}

function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number) {
  const qr = encode(url, { ecc: "Q", border: 0 });
  const cell = Math.floor(size / qr.size);
  const used = cell * qr.size;
  const ox = x + Math.floor((size - used) / 2);
  const oy = y + Math.floor((size - used) / 2);
  ctx.fillStyle = "#000";
  qr.data.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
    }),
  );
}

/** Lines that fit `max` px wide (at most `maxLines`, the last one cut with "…"). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last && ctx.measureText(`${last}…`).width > max) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function drawPoster(p: PosterInput): Promise<HTMLCanvasElement> {
  await document.fonts?.ready.catch(() => undefined);
  const logo = await loadImage(p.logoUrl ?? "");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Top band: logo + gym name.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, 340);
  let nameY = 215;
  if (logo) {
    const h = 120;
    const w = Math.min(360, (logo.width / logo.height) * h);
    ctx.drawImage(logo, (W - w) / 2, 54, w, h);
    nameY = 268;
  }
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${logo ? 58 : 76}px ${DISPLAY}`;
  const gym = wrap(ctx, p.gymName.toUpperCase(), W - 160, 1)[0] ?? "";
  ctx.fillText(gym, W / 2, nameY);
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 340, W, 14);

  // Headline.
  ctx.fillStyle = INK;
  ctx.font = `800 104px ${DISPLAY}`;
  ctx.fillText("Tell us honestly.", W / 2, 500);
  ctx.font = `500 40px ${SANS}`;
  ctx.fillStyle = "#3a3a3a";
  wrap(ctx, "Complaints, ideas or praise. No name, no phone number, no login.", W - 220, 2).forEach(
    (l, i) => ctx.fillText(l, W / 2, 575 + i * 54),
  );

  // QR card with a brand frame.
  const qrSize = 700;
  const qx = (W - qrSize) / 2;
  const qy = 690;
  ctx.fillStyle = BRAND;
  roundRect(ctx, qx - 34, qy - 34, qrSize + 68, qrSize + 68, 44);
  ctx.fill();
  ctx.fillStyle = "#fff";
  roundRect(ctx, qx - 22, qy - 22, qrSize + 44, qrSize + 44, 34);
  ctx.fill();
  drawQr(ctx, p.url, qx + 18, qy + 18, qrSize - 36);

  // How to.
  ctx.fillStyle = INK;
  ctx.font = `800 46px ${DISPLAY}`;
  ctx.fillText("SCAN WITH YOUR PHONE CAMERA", W / 2, 1540);
  ctx.font = `600 32px ${SANS}`;
  ctx.fillStyle = "#555";
  const where = wrap(ctx, p.place, W - 300, 1)[0] ?? "";
  if (where) ctx.fillText(where, W / 2, 1596);

  // Footer: the promise, and the address for anyone without a camera app.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 1640, W, H - 1640);
  ctx.fillStyle = "#fff";
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText("100% anonymous · We never see who wrote it", W / 2, 1690);
  ctx.font = `500 22px ${SANS}`;
  ctx.fillStyle = "#cfcfcf";
  ctx.fillText(p.url.replace(/^https?:\/\//, ""), W / 2, 1728);
  return canvas;
}

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image."))), "image/png"),
  );

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadPosterPng(p: PosterInput) {
  save(await toBlob(await drawPoster(p)), `feedback-poster-${slug(p.place)}.png`);
}

export async function downloadPosterPdf(p: PosterInput) {
  const { PDFDocument } = await import("pdf-lib");
  const png = await (await toBlob(await drawPoster(p))).arrayBuffer();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Feedback QR · ${p.place}`);
  const page = pdf.addPage([595.28, 841.89]);
  const img = await pdf.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const bytes = await pdf.save();
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  save(new Blob([body], { type: "application/pdf" }), `feedback-poster-${slug(p.place)}.pdf`);
}

/** Just the QR (1024 px, white quiet zone), for a designer's own poster or a sticker. */
export async function downloadQrPng(p: PosterInput) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1024, 1024);
  drawQr(ctx, p.url, 80, 80, 864);
  save(await toBlob(c), `feedback-qr-${slug(p.place)}.png`);
}

/** Opens the print dialog with the poster filling one A4 page. */
export async function printPoster(p: PosterInput) {
  const src = (await drawPoster(p)).toDataURL("image/png");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(
    `<!doctype html><title>Feedback QR</title><style>@page{size:A4;margin:0}html,body{margin:0}img{display:block;width:210mm;height:297mm}</style><img alt="" src="${src}">`,
  );
  d.close();
  const img = d.querySelector("img")!;
  await (img.complete ? Promise.resolve() : new Promise((r) => (img.onload = r)));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
}
