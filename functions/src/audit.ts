/**
 * Tamper-proof activity log.
 *
 * Every create / change / delete in the gym's data is recorded here by the server, with the
 * signed-in staff account that made it (from the Firestore auth context). The app can read
 * /auditLogs but Firestore rules forbid any browser from writing, editing or deleting it, so
 * the history of "who did what" cannot be changed from the app.
 */
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";

type D = Record<string, unknown>;
type Action = "created" | "updated" | "deleted";

/** Machine noise and derived records that would drown the log. */
const SKIP = new Set([
  "auditLogs",
  "attendance",
  "biometricCommands",
  "biometricTemplates",
  "whatsappWebhookEvents",
  "notifications",
  "automationActivities",
  "renewalNotifications",
  "birthdayNotifications",
  "publicInvoices",
  "expenseActivities",
  "importBatches",
]);
const NOISE = new Set([
  "updatedAt",
  "createdAt",
  "lastSeenAt",
  "lastIp",
  "cmdSeq",
  "lastSyncAt",
  "pdfUrl",
  "phoneNormalized",
  "deviceAccessChangedAt",
  "followupId",
  "publicToken",
  "lastWhatsappMessageAt",
  "deliveredAt",
  "readAt",
]);

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN")}`;
const short = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const t = (v as { toDate?: () => Date }).toDate?.();
    if (t) return t.toISOString();
    return JSON.stringify(v).slice(0, 200);
  }
  return typeof v === "string" ? v.slice(0, 200) : v;
};

function changedFields(before: D, after: D) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !NOISE.has(k) && JSON.stringify(short(before[k])) !== JSON.stringify(short(after[k])),
  );
}

const became = (f: string[], b: D, a: D, key: string, value: unknown) =>
  f.includes(key) && a[key] === value && b[key] !== value;

/** One human sentence per change. Returns null for changes not worth logging. */
function describe(col: string, action: Action, b: D, a: D, f: string[]): string | null {
  const d = action === "deleted" ? b : a;
  switch (col) {
    case "clients":
      if (action === "created") return `Member added: ${s(d["fullName"])} (${s(d["clientCode"])})`;
      if (action === "deleted") return `Member deleted: ${s(d["fullName"])} (${s(d["phone"])})`;
      if (became(f, b, a, "firstThumbRegistered", true)) return "Thumb registered on the device";
      if (became(f, b, a, "firstThumbRegistered", false)) return "Thumb must be registered again";
      if (became(f, b, a, "biometricStatus", "disabled")) return "Entry blocked by staff";
      if (b["biometricStatus"] === "disabled" && became(f, b, a, "biometricStatus", "active"))
        return "Entry allowed again";
      if (became(f, b, a, "deviceAccess", "removed")) return "Removed from the door device";
      if (became(f, b, a, "deviceAccess", "on") && b["deviceAccess"] === "removed")
        return "Added back to the door device";
      if (
        f.every((k) =>
          [
            "currentMembership",
            "status",
            "enrollmentId",
            "biometricStatus",
            "biometricUserId",
            "biometricDeviceId",
            "deviceAccess",
          ].includes(k),
        )
      )
        return null;
      return `Details changed: ${f.join(", ")}`;
    case "memberships":
      if (action === "created")
        return `Plan added: ${s(d["packageNameSnapshot"])} ${s(d["startDate"])} → ${s(d["endDate"])} (${s(d["status"])})`;
      if (action === "deleted") return `Plan deleted: ${s(d["packageNameSnapshot"])}`;
      if (f.includes("status"))
        return `Plan ${s(d["packageNameSnapshot"])}: ${s(b["status"])} → ${s(a["status"])}`;
      if (f.includes("startDate") || f.includes("endDate"))
        return `Plan ${s(d["packageNameSnapshot"])} dates: ${s(a["startDate"])} → ${s(a["endDate"])}`;
      return null;
    case "invoices":
      if (action === "created")
        return `Bill ${s(d["invoiceNumber"])}: ${money(d["total"])}, paid ${money(d["amountPaid"])}`;
      if (action === "deleted")
        return `Bill deleted: ${s(d["invoiceNumber"])} (${money(d["total"])})`;
      if (f.includes("amountPaid"))
        return `Bill ${s(d["invoiceNumber"])}: paid ${money(b["amountPaid"])} → ${money(a["amountPaid"])}`;
      return f.some((k) => !["paymentStatus", "balanceDue", "paymentsTracked"].includes(k))
        ? `Bill ${s(d["invoiceNumber"])} edited: ${f.join(", ")}`
        : null;
    case "payments":
      if (action === "created")
        return `Payment ${money(d["amount"])} by ${s(d["method"])} (${s(d["invoiceNumber"])})`;
      if (action === "deleted")
        return `Payment deleted: ${money(d["amount"])} (${s(d["invoiceNumber"])})`;
      return `Payment edited: ${f.join(", ")}`;
    case "ptAssignments":
      if (action === "created")
        return `PT added: ${s(d["ptPackageNameSnapshot"])} with ${s(d["trainerNameSnapshot"])} (trainer ${money(d["trainerShareAmount"])}, gym ${money(d["gymShareAmount"])})`;
      if (action === "deleted") return `PT deleted: ${s(d["ptPackageNameSnapshot"])}`;
      return f.includes("status")
        ? `PT ${s(d["ptPackageNameSnapshot"])}: ${s(b["status"])} → ${s(a["status"])}`
        : null;
    case "trainerPayouts":
      if (action === "created")
        return `Trainer share due: ${s(d["trainerNameSnapshot"])} ${money(d["trainerShareAmount"])}`;
      return f.includes("status")
        ? `Trainer payout ${s(d["trainerNameSnapshot"])} ${money(d["trainerShareAmount"])}: ${s(a["status"] ?? "deleted")}`
        : null;
    case "enrollments":
      if (f.includes("invoiceSharedAt") && !b["invoiceSharedAt"]) return "Bill shared on WhatsApp";
      if (became(f, b, a, "status", "active")) return "Joining completed";
      return action === "created" ? null : null;
    case "followups":
      if (
        action === "created" ||
        (f.includes("status") && a["status"] === "pending" && b["status"] !== "pending")
      )
        return `Call scheduled ${s(d["followUpDate"])} ${s(d["followUpTime"])}: ${s(d["nextAction"] || d["reason"])}`;
      if (became(f, b, a, "status", "completed"))
        return `Call done: ${s(a["outcome"]) || "completed"}`;
      if (f.includes("followUpDate"))
        return `Call moved to ${s(a["followUpDate"])} ${s(a["followUpTime"])}`;
      return action === "deleted" ? "Call deleted" : null;
    case "leadLogs":
      return action === "created"
        ? `Call recorded: ${s(d["response"])}${d["customerSaid"] ? ` — “${s(d["customerSaid"])}”` : ""}${d["nextCallDate"] ? ` · next call ${s(d["nextCallDate"])}` : ""}`
        : null;
    case "inquiries":
      if (action === "created") return `Inquiry: ${s(d["name"])} (${s(d["phone"])})`;
      if (action === "deleted") return `Inquiry deleted: ${s(d["name"])}`;
      if (f.includes("status"))
        return `Lead ${s(d["name"])}: ${s(b["status"])} → ${s(a["status"])}`;
      return null;
    case "whatsappMessages":
      if (
        action === "created" ||
        (f.includes("status") && ["sent", "failed"].includes(s(a["status"])))
      )
        return `WhatsApp ${s(d["type"])} ${s(d["status"])}${d["errorMessage"] ? `: ${s(d["errorMessage"])}` : ""}`;
      return null;
    case "expenses":
      return `Expense ${action}: ${s(d["title"])} ${money(d["amount"])}`;
    case "manualIncome":
      return `Other income ${action}: ${s(d["title"])} ${money(d["amount"])}`;
    case "packages":
    case "ptPackages":
      return `${col === "packages" ? "Gym" : "PT"} package ${action}: ${s(d["name"])} ${money(d["price"])}${action === "updated" ? ` (${f.join(", ")})` : ""}`;
    case "trainers":
      return `Trainer ${action}: ${s(d["name"])}${action === "updated" ? ` (${f.join(", ")})` : ""}`;
    case "biometricDevices":
      return `Fingerprint device ${action}: ${s(d["name"])}${action === "updated" ? ` (${f.join(", ")})` : ""}`;
    default:
      return `${col} ${action}${action === "updated" ? `: ${f.join(", ")}` : ""}`;
  }
}

const names = new Map<string, string>();
async function actorName(authType: string, authId: string | undefined) {
  if (authType === "app_user" && authId) {
    if (!names.has(authId)) {
      const u = await getAuth(getApp())
        .getUser(authId)
        .catch(() => null);
      names.set(authId, u?.email || u?.displayName || authId);
    }
    return names.get(authId)!;
  }
  if (authType === "service_account" || authType === "api_key" || authType === "system")
    return "System (automatic)";
  if (authType === "unauthenticated") return "Not signed in";
  return "Unknown";
}

export const auditTrail = onDocumentWrittenWithAuthContext(
  "{collection}/{docId}",
  async (event) => {
    const col = event.params.collection;
    if (SKIP.has(col) || (col === "settings" && event.params.docId === "counters")) return;
    const before = (event.data?.before?.data() ?? null) as D | null;
    const after = (event.data?.after?.data() ?? null) as D | null;
    const action: Action = !before ? "created" : !after ? "deleted" : "updated";
    const f = action === "updated" ? changedFields(before!, after!) : [];
    if (action === "updated" && !f.length) return;
    const summary =
      col === "settings"
        ? `Settings changed (${event.params.docId}): ${f.join(", ") || action}`
        : describe(col, action, before ?? {}, after ?? {}, f);
    if (!summary) return;
    const doc = (after ?? before ?? {}) as D;
    const clientId = col === "clients" ? event.params.docId : s(doc["clientId"]);
    const entry = {
      at: FieldValue.serverTimestamp(),
      collection: col,
      docId: event.params.docId,
      action,
      summary,
      clientId,
      clientName: s(doc["clientNameSnapshot"] ?? (col === "clients" ? doc["fullName"] : "")),
      actorType: event.authType,
      actorUid: event.authId ?? "",
      actorName: await actorName(event.authType, event.authId),
      changes:
        action === "updated"
          ? Object.fromEntries(
              f.slice(0, 12).map((k) => [k, { from: short(before![k]), to: short(after![k]) }]),
            )
          : {},
    };
    // The event id makes retries idempotent.
    await getFirestore(getApp())
      .doc(`auditLogs/${event.id}`)
      .create(entry)
      .catch((e: { code?: number }) => {
        if (e.code !== 6) logger.error("audit write failed", { error: String(e) });
      });
  },
);
