/**
 * Member feedback (spec C): complaints, ideas and praise members send from the app to the owner's
 * inbox (/feedback). The member app sends through the server; staff only reply and resolve.
 */
import type { FeedbackKind } from "../types/models";

export const FEEDBACK_LIMITS = { message: 1000, reply: 1000, perDay: 5 } as const;

export const FEEDBACK_KINDS: { key: FeedbackKind; label: string }[] = [
  { key: "complaint", label: "Complaint" },
  { key: "idea", label: "Idea" },
  { key: "praise", label: "Praise" },
];

export const feedbackKindLabel = (k: string) =>
  FEEDBACK_KINDS.find((x) => x.key === k)?.label ?? "Message";

export type FeedbackInput = { kind: FeedbackKind; message: string; wantsCall: boolean };

/** What the member typed, tidied: a known kind, trimmed text (blank lines squeezed), a yes/no. */
export function cleanFeedback(raw: unknown): FeedbackInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = FEEDBACK_KINDS.some((k) => k.key === o["kind"])
    ? (o["kind"] as FeedbackKind)
    : "idea";
  const message = String(o["message"] ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { kind, message, wantsCall: o["wantsCall"] === true };
}

export function validateFeedback(x: FeedbackInput): string {
  if (x.message.length < 3) return "Write a few words.";
  if (x.message.length > FEEDBACK_LIMITS.message)
    return `Keep it under ${FEEDBACK_LIMITS.message} characters.`;
  return "";
}

export function validateReply(reply: string): string {
  if (reply.trim().length > FEEDBACK_LIMITS.reply)
    return `Keep the reply under ${FEEDBACK_LIMITS.reply} characters.`;
  return "";
}

/**
 * At most 5 messages a day per member. `rate` = the member's counter doc ({ day, count });
 * returns the counter to save, or null when today's 5 are used up.
 */
export function nextFeedbackRate(rate: unknown, today: string): { day: string; count: number } | null {
  const r = (rate && typeof rate === "object" ? rate : {}) as { day?: unknown; count?: unknown };
  const used = r.day === today ? Number(r.count) || 0 : 0;
  return used >= FEEDBACK_LIMITS.perDay ? null : { day: today, count: used + 1 };
}
