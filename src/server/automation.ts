/**
 * Daily WhatsApp reminders, run by Vercel Cron (vite.config.ts → nitro vercel crons):
 *   /api/cron/morning  ~8 AM IST   renewal reminders + birthday wishes
 *   /api/cron/night    ~9:30 PM IST missed-workout nudges (after closing, punches are final)
 * Vercel's free plan runs each cron once a day, somewhere inside the scheduled hour.
 */
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { db, json, localDate } from "./admin";
import { sendTemplateMessage, whatsappNumber } from "./whatsapp";

type Kind = "renewal" | "birthday" | "absence" | "payment_due";
const COLLECTION: Record<Kind, string> = {
  renewal: "renewalNotifications",
  birthday: "birthdayNotifications",
  absence: "absenceNotifications",
  payment_due: "paymentDueNotifications",
};
type MembershipRow = { id: string; clientId: string; endDate: string; status: string };
type ClientRow = {
  id: string;
  fullName: string;
  phone: string;
  dateOfBirth?: string;
  whatsappOptIn?: boolean;
  whatsappPhone?: string;
};

const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** "2026-10-23" → "23 Oct 2026" for messages. */
const pretty = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
const id = (...p: string[]) => p.join("__").replace(/[^a-zA-Z0-9_-]/g, "_");
const render = (t: string, v: Record<string, string>) =>
  t.replace(/{{\s*(\w+)\s*}}/g, (_, k: string) => v[k] ?? "");

async function settings() {
  const s = await db().doc("settings/automation").get();
  return {
    automationEnabled: true,
    renewalEnabled: true,
    renewalDaysBefore: 7,
    birthdayEnabled: true,
    absenceEnabled: false,
    absenceDays: 3,
    paymentDueEnabled: true,
    paymentDueDaysBefore: 3,
    renewalTemplate: "Hi {{name}}, your membership expires on {{expiryDate}}.",
    birthdayTemplate: "Happy Birthday {{name}}!",
    ...s.data(),
  };
}
async function whatsappSettings() {
  const [ws, bs] = await Promise.all([
    db().doc("settings/whatsapp").get(),
    db().doc("settings/business").get(),
  ]);
  const s = ws.data() ?? {};
  return {
    gymName: String(bs.data()?.["businessName"] || "REBUILD FITNESS"),
    live: s["mode"] === "whatsapp",
    countryCode: String(s["defaultCountryCode"] ?? "91"),
    language: String(s["templateLanguage"] ?? "en"),
    renewalTemplate: String(s["renewalTemplate"] ?? "gym_membership_expiry"),
    birthdayTemplate: String(s["birthdayTemplate"] ?? "gym_birthday_wish"),
    absenceTemplate: String(s["absenceTemplate"] ?? "gym_miss_you"),
    paymentDueTemplate: String(s["paymentDueTemplate"] ?? "gym_payment_due"),
  };
}

/** Claims the reminder once (key is per member + day/streak), so a cron retry never double-sends. */
async function queue(
  kind: Kind,
  key: string,
  c: DocumentData,
  message: string,
  extra: Record<string, unknown>,
) {
  const firestore = db();
  const specific = firestore.doc(`${COLLECTION[kind]}/${key}`);
  return firestore.runTransaction(async (tx) => {
    if ((await tx.get(specific)).exists) return false;
    const now = FieldValue.serverTimestamp();
    const common = {
      clientId: c["id"],
      clientNameSnapshot: c["fullName"],
      phoneSnapshot: c["phone"],
      message,
      status: "queued",
      provider: "mock",
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(specific, { ...common, ...extra });
    tx.set(firestore.doc(`notifications/${key}`), {
      ...common,
      type: kind,
      referenceId: key,
      scheduledFor: localDate(),
      error: "",
    });
    tx.set(firestore.doc(`automationActivities/${key}`), {
      type: `${kind}_queued`,
      referenceId: key,
      clientId: c["id"],
      clientNameSnapshot: c["fullName"],
      description:
        kind === "renewal"
          ? "Renewal reminder queued"
          : kind === "birthday"
            ? "Birthday greeting queued"
            : kind === "payment_due"
              ? "Balance due reminder queued"
              : "Missed-workout nudge queued",
      createdAt: now,
      updatedAt: now,
    });
    return true;
  });
}

/**
 * Sends a queued reminder on WhatsApp when the Cloud API is on and the member agreed to
 * WhatsApp messages. Without the API the reminder stays in Message History for staff.
 */
async function deliver(
  kind: Kind,
  key: string,
  c: ClientRow,
  bodyParams: string[],
  wa: Awaited<ReturnType<typeof whatsappSettings>>,
  buttonUrlParam = "",
) {
  if (!wa.live || !c.whatsappOptIn) return;
  const to = whatsappNumber(c.whatsappPhone || c.phone, wa.countryCode);
  const templateName = {
    renewal: wa.renewalTemplate,
    birthday: wa.birthdayTemplate,
    absence: wa.absenceTemplate,
    payment_due: wa.paymentDueTemplate,
  }[kind];
  const result = to
    ? await sendTemplateMessage({
        to,
        templateName,
        language: wa.language,
        bodyParams,
        buttonUrlParam,
      })
    : ({ ok: false, error: "Invalid WhatsApp number.", code: "invalid_number" } as const);
  const now = FieldValue.serverTimestamp();
  const patch = result.ok
    ? { status: "sent", provider: "whatsapp", sentAt: now, error: "", updatedAt: now }
    : { status: "failed", provider: "whatsapp", error: result.error, updatedAt: now };
  const firestore = db();
  await Promise.all([
    firestore.doc(`${COLLECTION[kind]}/${key}`).update(patch),
    firestore.doc(`notifications/${key}`).update(patch),
    firestore.doc(`whatsappMessages/${id(kind, key)}`).set({
      clientId: c.id,
      clientNameSnapshot: c.fullName,
      phoneSnapshot: c.whatsappPhone || c.phone,
      normalizedPhone: to,
      type: kind,
      referenceId: key,
      provider: "whatsapp",
      templateName,
      templateLanguage: wa.language,
      messagePreview: bodyParams.join(" · "),
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.ok ? result.providerMessageId : "",
      sentAt: result.ok ? now : null,
      deliveredAt: null,
      readAt: null,
      failedAt: result.ok ? null : now,
      errorCode: result.ok ? "" : "send_failed",
      errorMessage: result.ok ? "" : result.error,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
}

export async function processRenewalReminders() {
  const cfg = await settings();
  if (!cfg.automationEnabled || !cfg.renewalEnabled) return 0;
  const wa = await whatsappSettings();
  const today = localDate();
  const target = plus(today, Number(cfg.renewalDaysBefore));
  const [members, clients] = await Promise.all([
    // Queued renewals are "pending" (or waiting for a thumb): they count as renewed too.
    db()
      .collection("memberships")
      .where("status", "in", ["active", "pending", "biometric_pending"])
      .get(),
    db().collection("clients").get(),
  ]);
  const all = members.docs.map((x) => ({ id: x.id, ...x.data() }) as MembershipRow);
  const cm = new Map(clients.docs.map((x) => [x.id, { id: x.id, ...x.data() } as ClientRow]));
  let sent = 0;
  for (const m of all.filter((x) => x.status === "active" && x.endDate === target)) {
    // Already renewed: a later plan exists (running, queued, or waiting for the thumb).
    if (
      all.some(
        (x) =>
          x.clientId === m.clientId &&
          x.id !== m.id &&
          x.status !== "cancelled" &&
          x.endDate > m.endDate,
      )
    )
      continue;
    const c = cm.get(m.clientId);
    if (!c) continue;
    const key = id(m.id, "renewal_7_days", today);
    const queued = await queue(
      "renewal",
      key,
      c,
      render(String(cfg.renewalTemplate), { name: c.fullName, expiryDate: pretty(m.endDate) }),
      { membershipId: m.id, expiryDate: m.endDate, reminderDate: today, type: "renewal_7_days" },
    );
    if (!queued) continue;
    sent += 1;
    await deliver("renewal", key, c, [c.fullName, wa.gymName, pretty(m.endDate)], wa);
  }
  return sent;
}

export async function processBirthdayNotifications() {
  const cfg = await settings();
  if (!cfg.automationEnabled || !cfg.birthdayEnabled) return 0;
  const wa = await whatsappSettings();
  const today = localDate();
  const year = Number(today.slice(0, 4));
  const clients = await db().collection("clients").get();
  let sent = 0;
  for (const d of clients.docs) {
    const c = { id: d.id, ...d.data() } as ClientRow;
    if (!c.dateOfBirth || c.dateOfBirth.slice(5) !== today.slice(5)) continue;
    const key = id(c.id, String(year), "birthday");
    const queued = await queue(
      "birthday",
      key,
      c,
      render(String(cfg.birthdayTemplate), { name: c.fullName }),
      {
        birthdayDate: today,
        year,
        type: "birthday",
      },
    );
    if (!queued) continue;
    sent += 1;
    await deliver("birthday", key, c, [c.fullName, wa.gymName], wa);
  }
  return sent;
}

/**
 * Balance due: one WhatsApp a day from `paymentDueDaysBefore` days before the next payment date
 * up to that date, with the balance and a View bill button (template gym_payment_due, Utility).
 */
export async function processPaymentDueReminders() {
  const cfg = await settings();
  if (!cfg.automationEnabled || !cfg.paymentDueEnabled) return 0;
  const wa = await whatsappSettings();
  const today = localDate();
  const before = Math.min(7, Math.max(0, Number(cfg.paymentDueDaysBefore ?? 3)));
  const bills = await db()
    .collection("invoices")
    .where("dueDate", ">=", today)
    .where("dueDate", "<=", plus(today, before))
    .get();
  let sent = 0;
  for (const b of bills.docs) {
    const inv = b.data();
    const balance = Number(inv["balanceDue"] ?? 0);
    if (!(balance > 0) || inv["paymentStatus"] === "refunded" || !inv["clientId"]) continue;
    const cs = await db()
      .doc(`clients/${String(inv["clientId"])}`)
      .get();
    if (!cs.exists) continue;
    const c = { id: cs.id, ...cs.data() } as ClientRow;
    const dueDate = String(inv["dueDate"]);
    // One message per bill per day.
    const key = id(b.id, "payment_due", today);
    const amount = balance.toLocaleString("en-IN");
    const queued = await queue(
      "payment_due",
      key,
      c,
      `Hi ${c.fullName}, ₹${amount} is due on ${pretty(dueDate)} on bill ${String(inv["invoiceNumber"] ?? "")}.`,
      { invoiceId: b.id, balanceDue: balance, dueDate, type: "payment_due" },
    );
    if (!queued) continue;
    sent += 1;
    await deliver(
      "payment_due",
      key,
      c,
      [c.fullName, wa.gymName, amount, String(inv["invoiceNumber"] ?? ""), pretty(dueDate)],
      wa,
      String(inv["publicToken"] ?? ""),
    );
  }
  return sent;
}

/** Rotated so members don't get the same line twice in a row. Keep each under ~150 chars. */
const QUOTES = [
  "The only bad workout is the one you skipped.",
  "Discipline is doing it even on the days you don't feel like it.",
  "Small steps every day add up to big results.",
  "Your body can do it. It's your mind you have to convince.",
  "Progress, not perfection.",
  "Don't wish for it. Work for it.",
  "Strong today, stronger tomorrow.",
  "Sweat now, shine later.",
  "The hardest part is showing up. You've done it before, do it again.",
  "Consistency beats motivation every single time.",
  "Every rep brings you closer to your goal.",
  "You don't have to be extreme, just consistent.",
];
const pickQuote = (key: string) =>
  QUOTES[[...key].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % QUOTES.length]!;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Missed-workout nudge (off by default; Settings → Reminders). A member with a running plan and a
 * registered thumb whose last allowed thumb punch is `absenceDays` or more days ago gets ONE
 * message per absence. It repeats only after they come back and miss again.
 */
export async function processAbsenceNudges() {
  const cfg = await settings();
  if (!cfg.automationEnabled || !cfg.absenceEnabled) return 0;
  const wa = await whatsappSettings();
  const minDays = Math.max(2, Number(cfg.absenceDays) || 3);
  const today = localDate();
  const [clients, plans, pts, visits] = await Promise.all([
    db().collection("clients").where("firstThumbRegistered", "==", true).get(),
    db().collection("memberships").where("status", "in", ["active", "pending"]).get(),
    db().collection("ptAssignments").where("status", "==", "active").get(),
    db().collection("attendance").where("attendanceDate", ">=", plus(today, -180)).get(),
  ]);
  const lastVisit = new Map<string, string>();
  visits.docs.forEach((v) => {
    const d = v.data();
    if (d["accessDecision"] !== "allowed" || !d["clientId"]) return;
    const prev = lastVisit.get(d["clientId"]);
    if (!prev || d["attendanceDate"] > prev) lastVisit.set(d["clientId"], d["attendanceDate"]);
  });
  const runningStart = new Map<string, string>();
  for (const doc of [...plans.docs, ...pts.docs]) {
    const d = doc.data();
    if (d["startDate"] > today || d["endDate"] < today) continue;
    const prev = runningStart.get(d["clientId"]);
    if (!prev || d["startDate"] < prev) runningStart.set(d["clientId"], d["startDate"]);
  }
  let sent = 0;
  for (const doc of clients.docs) {
    const c = { id: doc.id, ...doc.data() } as ClientRow & { biometricStatus?: string };
    const planStart = runningStart.get(c.id);
    if (c.biometricStatus !== "active" || !planStart) continue;
    const last = lastVisit.get(c.id);
    // Never visited on this plan: count from the day the plan started.
    const since = last && last >= planStart ? last : planStart;
    const gap = daysBetween(since, today);
    if (gap < minDays) continue;
    const key = id(c.id, "absence", since);
    const quote = pickQuote(key);
    const queued = await queue(
      "absence",
      key,
      c,
      `Hey ${c.fullName}, we missed you! ${gap} days since your last workout. "${quote}"`,
      { absentDays: gap, lastVisitDate: last ?? "", type: "absence" },
    );
    if (!queued) continue;
    sent += 1;
    await deliver("absence", key, c, [c.fullName, wa.gymName, String(gap), quote], wa);
  }
  return sent;
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret set, cron is off. */
export async function handleCron(request: Request, url: URL) {
  const secret = (process.env["CRON_SECRET"] ?? "").trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return json({ error: "Unauthorized" }, 401);
  const job = url.pathname.replace(/^\/api\/cron\/?/, "").replace(/\/+$/, "");
  if (job === "morning") {
    const renewals = await processRenewalReminders();
    const birthdays = await processBirthdayNotifications();
    const paymentsDue = await processPaymentDueReminders();
    return json({ ok: true, renewals, birthdays, paymentsDue });
  }
  if (job === "night") return json({ ok: true, absences: await processAbsenceNudges() });
  return json({ error: "Unknown job" }, 404);
}
