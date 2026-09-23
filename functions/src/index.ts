import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, type DocumentData } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { sendTemplateMessage, whatsappAccessToken, whatsappNumber } from "./whatsapp.js";
export { sendWhatsAppMessage, testWhatsAppConnection, whatsappWebhook } from "./whatsapp.js";
export { auditTrail } from "./audit.js";
export { invoicePdf } from "./invoice-pdf.js";
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
  };
}
async function queue(
  kind: "renewal" | "birthday",
  key: string,
  c: DocumentData,
  message: string,
  extra: Record<string, unknown>,
) {
  const specific = db.doc(
    `${kind === "renewal" ? "renewalNotifications" : "birthdayNotifications"}/${key}`,
  );
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
      type: kind === "renewal" ? "renewal_queued" : "birthday_queued",
      referenceId: key,
      clientId: c.id,
      clientNameSnapshot: c.fullName,
      description: kind === "renewal" ? "Renewal reminder queued" : "Birthday greeting queued",
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
  kind: "renewal" | "birthday",
  key: string,
  c: ClientRow,
  bodyParams: string[],
  wa: Awaited<ReturnType<typeof whatsappSettings>>,
) {
  if (!wa.live || !c.whatsappOptIn) return;
  const to = whatsappNumber(c.whatsappPhone || c.phone, wa.countryCode);
  const templateName = kind === "renewal" ? wa.renewalTemplate : wa.birthdayTemplate;
  const result = to
    ? await sendTemplateMessage({ to, templateName, language: wa.language, bodyParams })
    : ({ ok: false, error: "Invalid WhatsApp number." } as const);
  const now = FieldValue.serverTimestamp();
  const patch = result.ok
    ? { status: "sent", provider: "whatsapp", sentAt: now, error: "", updatedAt: now }
    : { status: "failed", provider: "whatsapp", error: result.error, updatedAt: now };
  const collection = kind === "renewal" ? "renewalNotifications" : "birthdayNotifications";
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
export const dailyRetentionAutomation = onSchedule(
  { schedule: "every day 08:00", timeZone: TZ, secrets: [whatsappAccessToken] },
  async () => {
    await processRenewalReminders();
    await processBirthdayNotifications();
  },
);
