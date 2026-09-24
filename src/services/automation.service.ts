import {
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { communicationProvider } from "@/lib/communication-provider";
import { DEFAULT_AUTOMATION_SETTINGS, renderTemplate } from "@/lib/automation-templates";
import {
  addDaysISOValue,
  birthdayMonthDay,
  deterministicId,
  indiaToday,
} from "@/lib/retention-dates";
import { formatDateISO } from "@/lib/format";
import type { AutomationSettings, Client, Membership, WhatsAppSettings } from "@/types/models";
import { mapClient } from "./clients.service";
import { col, COLLECTIONS } from "./firestore.service";
import { DEFAULT_WHATSAPP_SETTINGS } from "./whatsapp-settings.service";
import { sendWhatsAppMessage } from "./whatsapp.service";

const membership = (id: string, d: Record<string, unknown>): Membership => ({
  id,
  clientId: String(d["clientId"] ?? ""),
  packageId: String(d["packageId"] ?? ""),
  packageNameSnapshot: String(d["packageNameSnapshot"] ?? ""),
  priceSnapshot: Number(d["priceSnapshot"] ?? 0),
  durationDaysSnapshot: Number(d["durationDaysSnapshot"] ?? 0),
  startDate: String(d["startDate"] ?? ""),
  endDate: String(d["endDate"] ?? ""),
  counsellorId: String(d["counsellorId"] ?? ""),
  counsellorName: String(d["counsellorName"] ?? ""),
  status: (d["status"] ?? "pending") as Membership["status"],
  createdAt: new Date(),
  updatedAt: new Date(),
});
async function settings() {
  const [a, w] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.settings, "automation")),
    getDoc(doc(db, COLLECTIONS.settings, "whatsapp")),
  ]);
  return {
    automation: { ...DEFAULT_AUTOMATION_SETTINGS, ...(a.data() ?? {}) } as AutomationSettings,
    whatsapp: { ...DEFAULT_WHATSAPP_SETTINGS, ...(w.data() ?? {}) } as WhatsAppSettings,
  };
}
async function createQueued(
  kind: "renewal" | "birthday",
  id: string,
  client: Client,
  message: string,
  scheduledFor: string,
  extra: Record<string, unknown>,
  whatsapp: WhatsAppSettings,
) {
  const specific = doc(
      db,
      kind === "renewal" ? COLLECTIONS.renewalNotifications : COLLECTIONS.birthdayNotifications,
      id,
    ),
    notification = doc(db, COLLECTIONS.notifications, id),
    activity = doc(db, COLLECTIONS.automationActivities, id),
    provider = whatsapp.enabled ? whatsapp.mode : "mock";
  const claimed = await runTransaction(db, async (tx) => {
    if ((await tx.get(specific)).exists()) return false;
    const now = serverTimestamp(),
      common = {
        ...extra,
        clientId: client.id,
        clientNameSnapshot: client.fullName,
        phoneSnapshot: client.whatsappPhone || client.phone,
        status: "pending",
        provider,
        message,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
    tx.set(specific, common);
    tx.set(notification, {
      type: kind,
      referenceId: id,
      clientId: client.id,
      clientNameSnapshot: client.fullName,
      phoneSnapshot: client.whatsappPhone || client.phone,
      message,
      status: "scheduled",
      provider,
      scheduledFor,
      sentAt: null,
      error: "",
      createdAt: now,
      updatedAt: now,
    });
    return true;
  });
  if (!claimed) return false;
  try {
    if (whatsapp.enabled)
      await sendWhatsAppMessage({
        client,
        type: kind,
        referenceId: id,
        templateName: kind === "renewal" ? whatsapp.renewalTemplate : whatsapp.birthdayTemplate,
        templateLanguage: whatsapp.templateLanguage,
        parameters:
          kind === "renewal"
            ? [client.fullName, String(extra["expiryDate"] ?? "")]
            : [client.fullName],
        messagePreview: message,
        provider,
      });
    else
      await communicationProvider("mock").sendMessage({
        recipientName: client.fullName,
        phone: client.phone,
        type: kind,
        message,
        referenceId: id,
      });
    await runTransaction(db, async (tx) => {
      const now = serverTimestamp();
      tx.update(specific, { status: "queued", provider, updatedAt: now });
      tx.update(notification, { status: "queued", provider, error: "", updatedAt: now });
      tx.set(activity, {
        type: kind === "renewal" ? "renewal_queued" : "birthday_queued",
        referenceId: id,
        clientId: client.id,
        clientNameSnapshot: client.fullName,
        description: kind === "renewal" ? "Renewal reminder queued" : "Birthday greeting queued",
        createdAt: now,
        updatedAt: now,
      });
    });
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message : "Automation failed";
    await runTransaction(db, async (tx) => {
      const now = serverTimestamp();
      tx.update(specific, { status: "failed", updatedAt: now });
      tx.update(notification, { status: "failed", error: text, updatedAt: now });
      tx.set(activity, {
        type: "automation_failed",
        referenceId: id,
        clientId: client.id,
        clientNameSnapshot: client.fullName,
        description: text,
        createdAt: now,
        updatedAt: now,
      });
    });
    return true;
  }
}
export async function processRenewalReminders() {
  const { automation: cfg, whatsapp } = await settings();
  if (!cfg.automationEnabled || !cfg.renewalEnabled) return { created: 0, skipped: 0 };
  const today = indiaToday(),
    target = addDaysISOValue(today, cfg.renewalDaysBefore),
    [members, clients] = await Promise.all([
      getDocs(query(col(COLLECTIONS.memberships), where("status", "==", "active"))),
      getDocs(col(COLLECTIONS.clients)),
    ]);
  const all = members.docs.map((d) => membership(d.id, d.data())),
    clientMap = new Map(clients.docs.map((d) => [d.id, mapClient(d.id, d.data())]));
  let created = 0,
    skipped = 0;
  for (const m of all.filter((x) => x.endDate === target)) {
    if (
      all.some(
        (x) =>
          x.clientId === m.clientId &&
          x.id !== m.id &&
          x.status !== "cancelled" &&
          x.endDate > m.endDate,
      )
    ) {
      skipped++;
      continue;
    }
    const client = clientMap.get(m.clientId);
    if (!client) {
      skipped++;
      continue;
    }
    const id = deterministicId(m.id, "renewal_7_days", today),
      message = renderTemplate(cfg.renewalTemplate, {
        name: client.fullName,
        expiryDate: formatDateISO(m.endDate),
      });
    if (
      await createQueued(
        "renewal",
        id,
        client,
        message,
        today,
        { membershipId: m.id, expiryDate: m.endDate, reminderDate: today, type: "renewal_7_days" },
        whatsapp,
      )
    ) {
      created++;
      const follow = doc(db, COLLECTIONS.followups, deterministicId(m.id, "renewal_followup"));
      await runTransaction(db, async (tx) => {
        if ((await tx.get(follow)).exists()) return;
        const now = serverTimestamp();
        tx.set(follow, {
          clientId: client.id,
          inquiryId: client.inquiryId,
          clientNameSnapshot: client.fullName,
          phoneSnapshot: client.phone,
          source: "renewal",
          reason: "Membership Renewal",
          notes: "Generated from the renewal reminder.",
          followUpDate: addDaysISOValue(m.endDate, -3),
          followUpTime: "10:00",
          status: "pending",
          priority: "high",
          assignedTo: "",
          lastContactDate: null,
          nextAction: "Call about membership renewal",
          outcome: "",
          automated: true,
          parentFollowUpId: null,
          createdAt: now,
          updatedAt: now,
        });
      });
    } else skipped++;
  }
  return { created, skipped };
}
export async function processBirthdayNotifications() {
  const { automation: cfg, whatsapp } = await settings();
  if (!cfg.automationEnabled || !cfg.birthdayEnabled) return { created: 0, skipped: 0 };
  const today = indiaToday(),
    year = Number(today.slice(0, 4)),
    snap = await getDocs(col(COLLECTIONS.clients));
  let created = 0,
    skipped = 0;
  for (const d of snap.docs) {
    const client = mapClient(d.id, d.data());
    if (!client.dateOfBirth || birthdayMonthDay(client.dateOfBirth) !== today.slice(5)) continue;
    const id = deterministicId(client.id, String(year), "birthday"),
      message = renderTemplate(cfg.birthdayTemplate, { name: client.fullName });
    if (
      await createQueued(
        "birthday",
        id,
        client,
        message,
        today,
        { birthdayDate: today, year, type: "birthday" },
        whatsapp,
      )
    )
      created++;
    else skipped++;
  }
  return { created, skipped };
}
export async function sendBirthdayGreeting(client: Client) {
  const { automation: cfg, whatsapp } = await settings(),
    today = indiaToday(),
    year = Number(today.slice(0, 4)),
    id = deterministicId(client.id, String(year), "birthday"),
    message = renderTemplate(cfg.birthdayTemplate, { name: client.fullName });
  return createQueued(
    "birthday",
    id,
    client,
    message,
    today,
    { birthdayDate: today, year, type: "birthday" },
    whatsapp,
  );
}
