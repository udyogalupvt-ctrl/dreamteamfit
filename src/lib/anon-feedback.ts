/**
 * Anonymous feedback from QR posters in the gym. Staff make named links (feedbackLinks/{token},
 * "Front desk", "Changing room"…), print each one's QR, and anyone who scans it can write without
 * a login: src/server/anon-feedback.ts saves it to anonymousFeedback/{id}.
 *
 * Anonymous means: no name, phone, login, device or IP is saved with a message, and its time is
 * kept only to the hour (so the desk can't match it with who was in at 7:42 pm). Spam is held off
 * by a per-day counter keyed on a hash of the sender's network (never stored with the message).
 */
import { FEEDBACK_KINDS } from "./feedback.ts";
import type { FeedbackKind } from "../types/models";

export const ANON_LIMITS = {
  message: 1000,
  linkName: 60,
  note: 500,
  /** Messages one network (phone) may send in a day, across all links. */
  perSenderPerDay: 5,
  /** Messages one link takes in a day (a stuck bot can't flood the inbox). */
  perLinkPerDay: 300,
} as const;

export type AnonFeedbackInput = { kind: FeedbackKind; rating: number; message: string };

/** What the page sent, tidied: a known kind, a 1–5 rating (0 = not given), trimmed text. */
export function cleanAnonFeedback(raw: unknown): AnonFeedbackInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = FEEDBACK_KINDS.some((k) => k.key === o["kind"])
    ? (o["kind"] as FeedbackKind)
    : "idea";
  const r = typeof o["rating"] === "number" ? o["rating"] : 0;
  const rating = Number.isInteger(r) && r >= 1 && r <= 5 ? r : 0;
  const message = String(o["message"] ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { kind, rating, message };
}

export function validateAnonFeedback(x: AnonFeedbackInput): string {
  if (x.message.length < 3) return "Write a few words.";
  if (x.message.length > ANON_LIMITS.message)
    return `Keep it under ${ANON_LIMITS.message} characters.`;
  return "";
}

/** A link's name as staff typed it: one line, spaces squeezed. */
export const cleanLinkName = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

export function validateLinkName(name: string): string {
  if (name.length < 2) return "Give the QR a name, e.g. Front desk.";
  if (name.length > ANON_LIMITS.linkName)
    return `Keep the name under ${ANON_LIMITS.linkName} characters.`;
  return "";
}

/** 24 URL-safe characters (144 random bits): the link's id and the end of its URL. */
export function newFeedbackToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
export const isFeedbackToken = (t: string) => /^[A-Za-z0-9_-]{24}$/.test(t);

/** The page members open: /f/<token> on the app's own address. */
export const feedbackUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, "")}/f/${token}`;

/**
 * A per-day counter ({ day, count }): the counter to save, or null when today's `max` are used.
 * Another day's counter starts again from 0.
 */
export function nextDayCount(
  rate: unknown,
  today: string,
  max: number,
): { day: string; count: number } | null {
  const r = (rate && typeof rate === "object" ? rate : {}) as { day?: unknown; count?: unknown };
  const used = r.day === today ? Number(r.count) || 0 : 0;
  return used >= max ? null : { day: today, count: used + 1 };
}

/** The time saved with a message: the start of its hour (ms). */
export const toHour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;

/** "7–8 pm" for the hour a message came in (`d` = that hour's start, shown in the viewer's time). */
export function hourWindow(d: Date): string {
  const h = d.getHours();
  const label = (x: number) => {
    const v = x % 12 === 0 ? 12 : x % 12;
    return { v, ap: x % 24 < 12 ? "am" : "pm" };
  };
  const a = label(h);
  const b = label(h + 1);
  return a.ap === b.ap ? `${a.v}–${b.v} ${b.ap}` : `${a.v} ${a.ap}–${b.v} ${b.ap}`;
}

/** Totals for the inbox header: how many, the average rating of those rated, complaints. */
export function anonSummary(items: { rating: number; kind: string }[]) {
  const rated = items.filter((x) => x.rating >= 1 && x.rating <= 5);
  const avg = rated.length ? rated.reduce((t, x) => t + x.rating, 0) / rated.length : 0;
  return {
    total: items.length,
    rated: rated.length,
    average: Math.round(avg * 10) / 10,
    complaints: items.filter((x) => x.kind === "complaint").length,
  };
}

export const RATING_WORDS = ["", "Very bad", "Bad", "Okay", "Good", "Excellent"] as const;
