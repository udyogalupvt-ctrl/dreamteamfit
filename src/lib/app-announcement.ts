/**
 * Announcements in the member app (Announcements page → member app → Announcements). "Member app
 * only" is free; "WhatsApp + member app" also sends the approved WhatsApp template (announcement.ts).
 * Members read theirs through the server (src/server/portal-announcements.ts), never Firestore.
 */
import type { AnnouncementChannel } from "../types/models";

/** Longest message staff can type (the whole WhatsApp text must stay under 1024 letters). */
export const ANNOUNCEMENT_MAX = 500;

/** Home shows the newest announcement for this many days; older ones stay in Announcements. */
export const HOME_CARD_DAYS = 14;

/** Announcements one member's app lists. */
export const APP_LIST_MAX = 30;

/** The app keeps the owner's line breaks; extra blank lines and trailing spaces go. */
export const cleanAppMessage = (m: string) =>
  m
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function appMessageProblem(text: string): string {
  if (!text) return "Type the message first.";
  if (text.length > ANNOUNCEMENT_MAX) return `Keep it under ${ANNOUNCEMENT_MAX} letters.`;
  return "";
}

/**
 * A doc id that sorts newest first. The member app asks "announcements that list me" with no
 * orderBy, which Firestore answers in id order, so no extra index is needed.
 */
export function announcementId(now = Date.now(), rand = Math.random()) {
  const left = String(10_000_000_000_000 - now).padStart(13, "0");
  return `${left}_${Math.floor(rand * 36 ** 6)
    .toString(36)
    .padStart(6, "0")}`;
}

/** Members of the chosen groups (plus any extra ids), each once. */
export function appAudience(
  segments: Record<string, { client: { id: string } }[]>,
  groups: readonly string[],
  extra: readonly string[] = [],
): string[] {
  const ids = new Set<string>();
  for (const g of groups) for (const m of segments[g] ?? []) if (m.client.id) ids.add(m.client.id);
  for (const id of extra) if (id) ids.add(id);
  return [...ids];
}

/** Whether Home shows this announcement today (YYYY-MM-DD dates). */
export function onHome(sentOn: string, today: string, days = HOME_CARD_DAYS) {
  if (!sentOn || sentOn > today) return !!sentOn;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${sentOn}T00:00:00Z`);
  return ms / 86_400_000 < days;
}

/** Old announcements (before the member app copy existed) were WhatsApp only. */
export const channelOf = (v: unknown): AnnouncementChannel | "whatsappOnly" =>
  v === "app" ? "app" : v === "whatsapp" ? "whatsapp" : "whatsappOnly";

export const CHANNEL_LABEL: Record<AnnouncementChannel | "whatsappOnly", string> = {
  app: "Member app",
  whatsapp: "WhatsApp + app",
  whatsappOnly: "WhatsApp",
};
