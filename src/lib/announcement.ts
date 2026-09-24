import type { Segment, SegmentMember } from "@/lib/member-segments";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import type { AnnouncementGroup, AnnouncementRecipient, Client } from "@/types/models";

/** Longest message staff can type (the whole WhatsApp text must stay under 1024 letters). */
export const ANNOUNCEMENT_MAX = 500;

export type LeftOut = { name: string; phone: string; reason: string };

/** WhatsApp does not allow line breaks inside a template value, so the message is one paragraph. */
export const cleanMessage = (m: string) => m.replace(/\s+/g, " ").trim();
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

/** Exactly what the member reads: the approved "gym_announcement" template filled in. */
export const announcementText = (name: string, gym: string, message: string) =>
  `Hello ${firstName(name)}, here is an update from ${gym}:\n\n${cleanMessage(message)}\n\nFor any questions, please contact the front desk. Thank you!`;

/** Numbers staff typed or pasted: one per line, or separated by commas. */
export const splitNumbers = (text: string) =>
  text
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Who gets the announcement. Each WhatsApp number only once; members who said no to WhatsApp
 * are left out, even when their number is typed by hand.
 */
export function buildRecipients(
  segments: Record<Segment, SegmentMember[]>,
  groups: readonly AnnouncementGroup[],
  typed: string,
  clients: Client[],
  countryCode: string,
) {
  const recipients: AnnouncementRecipient[] = [];
  const leftOut: LeftOut[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const phoneOf = (c: Client) => normalizeWhatsAppPhone(c.whatsappPhone || c.phone, countryCode);
  const addMember = (c: Client) => {
    const p = phoneOf(c);
    if (!p.ok)
      return void leftOut.push({ name: c.fullName, phone: c.phone, reason: "No valid number" });
    if (seen.has(p.value)) return;
    seen.add(p.value);
    if (!c.whatsappOptIn)
      return void leftOut.push({ name: c.fullName, phone: c.phone, reason: "Said no to WhatsApp" });
    recipients.push({ clientId: c.id, name: c.fullName, phone: p.value });
  };

  for (const g of groups) for (const m of segments[g]) addMember(m.client);

  const members = new Map<string, Client>();
  for (const c of clients) {
    const p = phoneOf(c);
    if (p.ok && !members.has(p.value)) members.set(p.value, c);
  }
  for (const raw of splitNumbers(typed)) {
    const p = normalizeWhatsAppPhone(raw, countryCode);
    if (!p.ok) {
      invalid.push(raw);
      continue;
    }
    const member = members.get(p.value);
    if (member) {
      addMember(member);
      continue;
    }
    if (seen.has(p.value)) continue;
    seen.add(p.value);
    recipients.push({ clientId: "", name: "", phone: p.value });
  }
  return { recipients, leftOut, invalid };
}
