/**
 * Messages sent from the gym's own WhatsApp number (linked phone). Unlike the Meta Cloud API there
 * are no approved templates: the text is written here (and can be changed in Settings → WhatsApp).
 * The values are the same ones, in the same order, the Meta templates get, so every screen and
 * reminder works with either way of sending. Used by the server (to send) and Settings (to edit).
 */

export const PHONE_TEXT_KINDS = [
  "invoice",
  "payment_due",
  "renewal",
  "birthday",
  "absence",
  "announcement",
  "member_app",
  "test",
] as const;
export type PhoneTextKind = (typeof PHONE_TEXT_KINDS)[number];

export const PHONE_TEXT_LABELS: Record<PhoneTextKind, string> = {
  invoice: "Bill after payment",
  payment_due: "Balance due reminder",
  renewal: "Renewal reminder (plan ending)",
  birthday: "Birthday wish",
  absence: "Missed-workout nudge",
  announcement: "Announcement",
  member_app: "Member app link",
  test: "Test message",
};

/** The values each message gets, in order (as the Meta templates' {{1}}, {{2}}…). */
export const PHONE_TEXT_FIELDS: Record<PhoneTextKind, string[]> = {
  invoice: ["name", "gym", "bill", "paid", "balance"],
  payment_due: ["name", "gym", "amount", "bill", "date"],
  renewal: ["name", "gym", "date"],
  birthday: ["name", "gym"],
  absence: ["name", "gym", "days", "quote"],
  announcement: ["name", "gym", "message"],
  member_app: ["name", "gym"],
  test: ["name", "gym"],
};

/** Messages that carry a link ({link}): the bill page or the member app. */
export const PHONE_TEXT_LINKS: Partial<Record<PhoneTextKind, "invoice" | "member_app">> = {
  invoice: "invoice",
  payment_due: "invoice",
  member_app: "member_app",
};

export const DEFAULT_PHONE_TEXTS: Record<PhoneTextKind, string> = {
  invoice: `Hi {name}, thanks for powering up with {gym}! 💪

Your payment is confirmed ✅
🧾 Bill no: {bill}
💰 Amount paid: ₹{paid}
⏳ Balance due: ₹{balance}

View, download or print your bill: {link}

Keep showing up, every rep counts. See you on the floor! 🔥`,
  payment_due: `Hello {name}, this is a payment reminder from {gym}.

A balance of ₹{amount} for bill {bill} is due on {date}. You can pay at the front desk.

See your bill: {link}

If you have already paid, please ignore this message.`,
  renewal: `Hello {name}, this is a reminder from {gym}.

Your membership is valid until {date}. To keep training without a break, please renew your plan at the front desk on or before this date.

If you have already renewed, please ignore this message.`,
  birthday: `Happy birthday, {name}! 🎉🎂

Everyone at {gym} is cheering for you today. Here's to a year of new personal bests, more strength and great health.

Celebrate hard, train harder. Keep crushing it! 💪`,
  absence: `Hey {name}, we have missed you at {gym}! 👋

It's been {days} days since your last workout.

💬 "{quote}"

Your goals are waiting. Let's get back at it from tomorrow — see you on the floor! 💪🔥`,
  announcement: `Hello {name}, here is an update from {gym}:

{message}

For any questions, please contact the front desk. Thank you!`,
  member_app: `Hi {name}, your {gym} member app is ready ✅
See your package, visits, payments and workout plan here: {link}

Password: your date of birth as DDMMYYYY (born 25 Aug 1995 → 25081995).`,
  test: `Hi {name}, this is a test message from {gym}. WhatsApp sending is working ✅`,
};

const known = (k: string): k is PhoneTextKind =>
  (PHONE_TEXT_KINDS as readonly string[]).includes(k);

/**
 * The text for one message: the gym's own wording when set, else the default, with the values
 * filled in. A line with {link} is left out when there is no link.
 */
export function renderPhoneText(
  kind: string,
  values: string[],
  link: string,
  custom?: Partial<Record<string, string>>,
) {
  if (!known(kind)) return values.filter(Boolean).join("\n");
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
