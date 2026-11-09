/**
 * The printable poster for an anonymous feedback QR (browser only). Laid out on an A4 grid of
 * 1240 × 1754 units and drawn at 300 dpi (2480 × 3508 px) for print shops, then saved as PNG, put
 * in an A4 PDF, or sent to the printer. The QR is black on white with high error correction (H), so
 * the gym logo in its centre and a scuffed print still scan.
 */
import { encode } from "uqr";

export type PosterInput = { url: string; gymName: string; place: string; logoUrl?: string };
/** Says whether the logo failed to load; the poster is still made without it. */
export type PosterResult = { logoMissing: boolean };

const W = 1240;
const H = 1754;
/** 1240 units × 2 = 2480 px = A4 width at 300 dpi. */
const PRINT_SCALE = 2;
const A4: [number, number] = [595.28, 841.89];
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

const logoCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const hit = logoCache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    // Needs CORS (Cloudinary sends it); otherwise the canvas could not be saved, so skip the logo.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 8000);
  });
  logoCache.set(src, p);
  void p.then((img) => {
    if (!img) logoCache.delete(src);
  });
  return p;
}

/**
 * The QR in a `size` square at (x, y). With a logo, the centre gets a white rounded tile holding
 * the logo, covering ~5% of the code: well inside what error correction H (30%) repairs.
 */
function drawQr(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  size: number,
  logo: HTMLImageElement | null,
) {
  const qr = encode(url, { ecc: "H", border: 0 });
  const cell = size / qr.size;
  ctx.fillStyle = "#000";
  qr.data.forEach((row, r) =>
    row.forEach((dark, c) => {
      // A slight overlap, so no hairline gaps show between modules in print.
      if (dark) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.35, cell + 0.35);
    }),
  );
  if (!logo) return;
  const tile = Math.round(size * 0.22);
  const tx = x + (size - tile) / 2;
  const ty = y + (size - tile) / 2;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(tx, ty, tile, tile, tile * 0.18);
  ctx.fill();
  const box = tile * 0.84;
  const ratio = logo.width / logo.height;
  const lw = ratio >= 1 ? box : box * ratio;
  const lh = ratio >= 1 ? box / ratio : box;
  ctx.drawImage(logo, tx + (tile - lw) / 2, ty + (tile - lh) / 2, lw, lh);
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

export async function drawPoster(
  p: PosterInput,
): Promise<{ canvas: HTMLCanvasElement } & PosterResult> {
  await document.fonts?.ready.catch(() => undefined);
  const logo = await loadImage(p.logoUrl ?? "");
  const canvas = document.createElement("canvas");
  canvas.width = W * PRINT_SCALE;
  canvas.height = H * PRINT_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PRINT_SCALE, PRINT_SCALE);
  ctx.imageSmoothingQuality = "high";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Top band: the gym logo, big (it carries the name). No logo: the name in large type.
  const band = 380;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, band);
  if (logo) {
    const ratio = logo.width / logo.height;
    const lw = Math.min(W - 160, ratio * 310);
    const lh = lw / ratio;
    ctx.drawImage(logo, (W - lw) / 2, (band - lh) / 2, lw, lh);
  } else {
    ctx.fillStyle = "#fff";
    ctx.font = `800 84px ${DISPLAY}`;
    ctx.fillText(wrap(ctx, p.gymName.toUpperCase(), W - 160, 1)[0] ?? "", W / 2, 222);
  }
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, band, W, 14);

  // Headline.
  ctx.fillStyle = INK;
  ctx.font = `800 96px ${DISPLAY}`;
  ctx.fillText("Tell us honestly.", W / 2, 518);
  ctx.font = `500 38px ${SANS}`;
  ctx.fillStyle = "#3a3a3a";
  wrap(ctx, "Complaints, ideas or praise. No name, no phone number, no login.", W - 220, 2).forEach(
    (l, i) => ctx.fillText(l, W / 2, 586 + i * 50),
  );

  // QR card with a brand frame; the white card is the scanner's quiet zone.
  const qrSize = 640;
  const qx = (W - qrSize) / 2;
  const qy = 724;
  ctx.fillStyle = BRAND;
  roundRect(ctx, qx - 34, qy - 34, qrSize + 68, qrSize + 68, 44);
  ctx.fill();
  ctx.fillStyle = "#fff";
  roundRect(ctx, qx - 22, qy - 22, qrSize + 44, qrSize + 44, 34);
  ctx.fill();
  drawQr(ctx, p.url, qx + 22, qy + 22, qrSize - 44, logo);

  // How to.
  ctx.fillStyle = INK;
  ctx.font = `800 46px ${DISPLAY}`;
  ctx.fillText("SCAN WITH YOUR PHONE CAMERA", W / 2, 1514);
  ctx.font = `600 32px ${SANS}`;
  ctx.fillStyle = "#555";
  const where = wrap(ctx, p.place, W - 300, 1)[0] ?? "";
  if (where) ctx.fillText(where, W / 2, 1574);

  // Footer: the promise, and the address for anyone without a camera app.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 1630, W, H - 1630);
  ctx.fillStyle = "#fff";
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText("100% anonymous · We never see who wrote it", W / 2, 1684);
  ctx.font = `500 22px ${SANS}`;
  ctx.fillStyle = "#cfcfcf";
  ctx.fillText(p.url.replace(/^https?:\/\//, ""), W / 2, 1724);
  return { canvas, logoMissing: !!p.logoUrl && !logo };
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

export async function downloadPosterPng(p: PosterInput): Promise<PosterResult> {
  const { canvas, logoMissing } = await drawPoster(p);
  save(await toBlob(canvas), `feedback-poster-${slug(p.place)}.png`);
  return { logoMissing };
}

/**
 * One A4 page per QR at 300 dpi, edge to edge: the file to take to a print shop. Several posters
 * go into one PDF, so all of them print in one go.
 */
export async function downloadPosterPdf(
  posters: PosterInput[],
  fileName?: string,
): Promise<PosterResult> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    posters.length === 1 ? `Feedback QR · ${posters[0]?.place ?? ""}` : "Feedback QR posters",
  );
  let logoMissing = false;
  for (const p of posters) {
    const drawn = await drawPoster(p);
    logoMissing ||= drawn.logoMissing;
    const img = await pdf.embedPng(await (await toBlob(drawn.canvas)).arrayBuffer());
    pdf.addPage(A4).drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  const bytes = await pdf.save();
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  save(
    new Blob([body], { type: "application/pdf" }),
    fileName ?? `feedback-poster-${slug(posters[0]?.place ?? "qr")}.pdf`,
  );
  return { logoMissing };
}

/** Just the QR with the logo in its centre (2048 px, white quiet zone), for stickers or a designer. */
export async function downloadQrPng(p: PosterInput): Promise<PosterResult> {
  const logo = await loadImage(p.logoUrl ?? "");
  const c = document.createElement("canvas");
  c.width = c.height = 2048;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 2048, 2048);
  drawQr(ctx, p.url, 160, 160, 1728, logo);
  save(await toBlob(c), `feedback-qr-${slug(p.place)}.png`);
  return { logoMissing: !!p.logoUrl && !logo };
}

/** Opens the print dialog with the poster filling one A4 page. */
export async function printPoster(p: PosterInput): Promise<PosterResult> {
  const { canvas, logoMissing } = await drawPoster(p);
  const src = canvas.toDataURL("image/png");
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
  return { logoMissing };
}
