/**
 * Messages sent from the gym's own WhatsApp number (linked phone). Unlike the Meta Cloud API there
 * are no approved templates: the text is written here (and can be changed in Settings → WhatsApp).
 * The values are the same ones, in the same order, the Meta templates get, so the screens that
 * send them work with either way of sending. Used by the server (to send) and Settings (to edit).
 *
 * Only messages a member expects right after paying (their bill, their member app link) and the
 * Settings test go from the gym's number. Reminders, wishes and announcements go to many people
 * unasked, the pattern WhatsApp bans numbers for, so they never go from it: reminders use app
 * notifications instead. The server checks this on every send (phoneMaySend).
 */

export const PHONE_TEXT_KINDS = ["invoice", "member_app", "test"] as const;
export type PhoneTextKind = (typeof PHONE_TEXT_KINDS)[number];

export const phoneMaySend = (kind: string): kind is PhoneTextKind =>
  (PHONE_TEXT_KINDS as readonly string[]).includes(kind);

export const PHONE_TEXT_LABELS: Record<PhoneTextKind, string> = {
  invoice: "Bill after payment",
  member_app: "Member app link",
  test: "Test message",
};

/** The values each message gets, in order (as the Meta templates' {{1}}, {{2}}…). */
export const PHONE_TEXT_FIELDS: Record<PhoneTextKind, string[]> = {
  invoice: ["name", "gym", "bill", "paid", "balance"],
  member_app: ["name", "gym"],
  test: ["name", "gym"],
};

/** Messages that carry a link ({link}): the bill page or the member app. */
export const PHONE_TEXT_LINKS: Partial<Record<PhoneTextKind, "invoice" | "member_app">> = {
  invoice: "invoice",
  member_app: "member_app",
};

const SAVE_NUMBER = "📌 Please save this number so our messages always reach you.";

export const DEFAULT_PHONE_TEXTS: Record<PhoneTextKind, string> = {
  invoice: `Hi {name}, thanks for powering up with {gym}! 💪

Your payment is confirmed ✅
🧾 Bill no: {bill}
💰 Amount paid: ₹{paid}
⏳ Balance due: ₹{balance}

View, download or print your bill: {link}

Keep showing up, every rep counts. See you on the floor! 🔥

${SAVE_NUMBER}`,
  member_app: `Hi {name}, your {gym} member app is ready ✅
See your package, visits, payments and workout plan here: {link}

Password: your date of birth as DDMMYYYY (born 25 Aug 1995 → 25081995).

${SAVE_NUMBER}`,
  test: `Hi {name}, this is a test message from {gym}. WhatsApp sending is working ✅`,
};

/**
 * The text for one message: the gym's own wording when set, else the default, with the values
 * filled in. A line with {link} is left out when there is no link.
 */
export function renderPhoneText(
  kind: PhoneTextKind,
  values: string[],
  link: string,
  custom?: Partial<Record<string, string>>,
) {
  const template = (custom?.[kind] ?? "").trim() || DEFAULT_PHONE_TEXTS[kind];
  const byName: Record<string, string> = { link };
  PHONE_TEXT_FIELDS[kind].forEach((f, i) => (byName[f] = values[i] ?? ""));
  return template
    .split("\n")
    .filter((line) => link || !line.includes("{link}"))
    .join("\n")
    .replace(/{(\w+)}/g, (whole, f: string) => (f in byName ? byName[f]! : whole))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
