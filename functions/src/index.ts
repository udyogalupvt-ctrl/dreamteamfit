import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, type DocumentData } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { sendTemplateMessage, whatsappAccessToken, whatsappNumber } from "./whatsapp.js";
export { sendWhatsAppMessage, testWhatsAppConnection, whatsappWebhook } from "./whatsapp.js";
export { auditTrail } from "./audit.js";
export {
  dailyDoorAccessSync,
  doorAccessOnClient,
  doorAccessOnMembership,
  doorAccessOnPt,
  iclock,
} from "./biometric.js";

initializeApp();
const db = getFirestore(),
  TZ = "Asia/Kolkata";
type Kind = "renewal" | "birthday" | "absence";
const COLLECTION: Record<Kind, string> = {
  renewal: "renewalNotifications",
  birthday: "birthdayNotifications",
  absence: "absenceNotifications",
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
const date = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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
  const s = await db.doc("settings/automation").get();
  return {
    automationEnabled: true,
    renewalEnabled: true,
    renewalDaysBefore: 7,
    birthdayEnabled: true,
    absenceEnabled: false,
    absenceDays: 3,
    renewalTemplate: "Hi {{name}}, your Rebuild Fitness membership expires on {{expiryDate}}.",
    birthdayTemplate: "Happy Birthday {{name}}! — REBUILD FITNESS",
    ...s.data(),
  };
}
async function whatsappSettings() {
  const [ws, bs] = await Promise.all([
    db.doc("settings/whatsapp").get(),
    db.doc("settings/business").get(),
  ]);
  const s = ws.data() ?? {};
  return {
    gymName: String(bs.data()?.["businessName"] || "REBUILD FITNESS"),
    live: s["mode"] === "whatsapp",
    countryCode: String(s["defaultCountryCode"] ?? "91"),
    language: String(s["templateLanguage"] ?? "en"),
    renewalTemplate: String(s["renewalTemplate"] ?? "gym_renewal_reminder"),
    birthdayTemplate: String(s["birthdayTemplate"] ?? "gym_birthday_wish"),
    absenceTemplate: String(s["absenceTemplate"] ?? "gym_miss_you"),
  };
}
async function queue(
  kind: Kind,
  key: string,
  c: DocumentData,
  message: string,
  extra: Record<string, unknown>,
) {
  const specific = db.doc(`${COLLECTION[kind]}/${key}`);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(specific)).exists) return false;
    const now = FieldValue.serverTimestamp(),
      common = {
        clientId: c.id,
        clientNameSnapshot: c.fullName,
        phoneSnapshot: c.phone,
        message,
        status: "queued",
        provider: "mock",
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
    tx.set(specific, { ...common, ...extra });
    tx.set(db.doc(`notifications/${key}`), {
      ...common,
      type: kind,
      referenceId: key,
      scheduledFor: date(),
      error: "",
    });
    tx.set(db.doc(`automationActivities/${key}`), {
      type: `${kind}_queued`,
      referenceId: key,
      clientId: c.id,
      clientNameSnapshot: c.fullName,
      description:
        kind === "renewal"
          ? "Renewal reminder queued"
          : kind === "birthday"
            ? "Birthday greeting queued"
            : "Missed-workout nudge queued",
      createdAt: now,
      updatedAt: now,
    });
    return true;
  });
}

/**
 * Sends a queued reminder on WhatsApp when the Cloud API is live and the member agreed to
 * WhatsApp messages. Without the API the reminder stays in Message History for staff.
 */
async function deliver(
  kind: Kind,
  key: string,
  c: ClientRow,
  bodyParams: string[],
  wa: Awaited<ReturnType<typeof whatsappSettings>>,
) {
  if (!wa.live || !c.whatsappOptIn) return;
  const to = whatsappNumber(c.whatsappPhone || c.phone, wa.countryCode);
  const templateName =
    kind === "renewal"
      ? wa.renewalTemplate
      : kind === "birthday"
        ? wa.birthdayTemplate
        : wa.absenceTemplate;
  const result = to
    ? await sendTemplateMessage({ to, templateName, language: wa.language, bodyParams })
    : ({ ok: false, error: "Invalid WhatsApp number." } as const);
  const now = FieldValue.serverTimestamp();
  const patch = result.ok
    ? { status: "sent", provider: "whatsapp", sentAt: now, error: "", updatedAt: now }
    : { status: "failed", provider: "whatsapp", error: result.error, updatedAt: now };
  const collection = COLLECTION[kind];
  await Promise.all([
    db.doc(`${collection}/${key}`).update(patch),
    db.doc(`notifications/${key}`).update(patch),
    db.doc(`whatsappMessages/${id(kind, key)}`).set({
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
  if (!cfg.automationEnabled || !cfg.renewalEnabled) return;
  const wa = await whatsappSettings();
  const today = date(),
    target = plus(today, Number(cfg.renewalDaysBefore)),
    [members, clients] = await Promise.all([
      db.collection("memberships").where("status", "==", "active").get(),
      db.collection("clients").get(),
    ]),
    all = members.docs.map((x) => ({ id: x.id, ...x.data() }) as MembershipRow),
    cm = new Map(clients.docs.map((x) => [x.id, { id: x.id, ...x.data() } as ClientRow]));
  for (const m of all.filter((x) => x.endDate === target)) {
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
    if (queued) await deliver("renewal", key, c, [c.fullName, wa.gymName, pretty(m.endDate)], wa);
  }
}
export async function processBirthdayNotifications() {
  const cfg = await settings();
  if (!cfg.automationEnabled || !cfg.birthdayEnabled) return;
  const wa = await whatsappSettings();
  const today = date(),
    year = Number(today.slice(0, 4)),
    clients = await db.collection("clients").get();
  for (const d of clients.docs) {
    const c = { id: d.id, ...d.data() } as ClientRow;
    if (!c.dateOfBirth || c.dateOfBirth.slice(5) !== today.slice(5)) continue;
    const key = id(c.id, String(year), "birthday");
    const queued = await queue(
      "birthday",
      key,
      c,
      render(String(cfg.birthdayTemplate), { name: c.fullName }),
      { birthdayDate: today, year, type: "birthday" },
    );
    if (queued) await deliver("birthday", key, c, [c.fullName, wa.gymName], wa);
  }
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
 * registered thumb whose last allowed thumb punch at the door is `absenceDays` or more days ago
 * gets ONE motivating message per absence. It repeats only after they come back and miss again.
 */
export async function processAbsenceNudges() {
  const cfg = await settings();
  if (!cfg.automationEnabled || !cfg.absenceEnabled) return;
  const wa = await whatsappSettings();
  const minDays = Math.max(2, Number(cfg.absenceDays) || 3);
  const today = date();
  const [clients, plans, pts, visits] = await Promise.all([
    db.collection("clients").where("firstThumbRegistered", "==", true).get(),
    db.collection("memberships").where("status", "in", ["active", "pending"]).get(),
    db.collection("ptAssignments").where("status", "==", "active").get(),
    db.collection("attendance").where("attendanceDate", ">=", plus(today, -180)).get(),
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
    if (queued) await deliver("absence", key, c, [c.fullName, wa.gymName, String(gap), quote], wa);
  }
}

export const dailyRetentionAutomation = onSchedule(
  { schedule: "every day 08:00", timeZone: TZ, secrets: [whatsappAccessToken] },
  async () => {
    await processRenewalReminders();
    await processBirthdayNotifications();
  },
);

/** 9:30 PM, after the gym closes, so today's thumb punches are final before counting absences. */
export const nightlyAbsenceNudges = onSchedule(
  { schedule: "every day 21:30", timeZone: TZ, secrets: [whatsappAccessToken] },
  async () => {
    await processAbsenceNudges();
  },
);
