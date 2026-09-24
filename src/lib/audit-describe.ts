/** Human wording for the activity log. One sentence per change, or null when not worth logging. */

type D = Record<string, unknown>;
export type AuditAction = "created" | "updated" | "deleted";

/** Machine noise and derived records that would drown the log. */
export const AUDIT_SKIP = new Set([
  "auditLogs",
  "attendance",
  "biometricCommands",
  "biometricTemplates",
  "whatsappWebhookEvents",
  "notifications",
  "automationActivities",
  "renewalNotifications",
  "birthdayNotifications",
  "absenceNotifications",
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
  "lastDoorSyncDate",
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
export const short = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const t = (v as { toDate?: () => Date }).toDate?.();
    if (t) return t.toISOString();
    return JSON.stringify(v).slice(0, 200);
  }
  return typeof v === "string" ? v.slice(0, 200) : v;
};

export function changedFields(before: D, after: D) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !NOISE.has(k) && JSON.stringify(short(before[k])) !== JSON.stringify(short(after[k])),
  );
}

const became = (f: string[], b: D, a: D, key: string, value: unknown) =>
  f.includes(key) && a[key] === value && b[key] !== value;

function describe(col: string, action: AuditAction, b: D, a: D, f: string[]): string | null {
  const d = action === "deleted" ? b : a;
  switch (col) {
    case "clients":
      if (action === "created") return `Member added: ${s(d["fullName"])} (${s(d["clientCode"])})`;
      if (action === "deleted") return `Member deleted: ${s(d["fullName"])} (${s(d["phone"])})`;
      if (became(f, b, a, "biometricStatus", "disabled")) return "Entry blocked by staff";
      if (b["biometricStatus"] === "disabled" && became(f, b, a, "biometricStatus", "active"))
        return "Entry allowed again";
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
            "firstThumbRegistered",
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
      return null;
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

/** The log line for one write, or null when nothing worth recording changed. */
export function auditLine(col: string, docId: string, before: D | null, after: D | null) {
  if (AUDIT_SKIP.has(col) || (col === "settings" && docId === "counters")) return null;
  const action: AuditAction = !before ? "created" : !after ? "deleted" : "updated";
  const f = action === "updated" ? changedFields(before!, after!) : [];
  if (action === "updated" && !f.length) return null;
  const summary =
    col === "settings"
      ? `Settings changed (${docId}): ${f.join(", ") || action}`
      : describe(col, action, before ?? {}, after ?? {}, f);
  if (!summary) return null;
  const doc = (after ?? before ?? {}) as D;
  return {
    collection: col,
    docId,
    action,
    summary,
    clientId: col === "clients" ? docId : s(doc["clientId"]),
    clientName: s(doc["clientNameSnapshot"] ?? (col === "clients" ? doc["fullName"] : "")),
    changes:
      action === "updated"
        ? Object.fromEntries(
            f.slice(0, 12).map((k) => [k, { from: short(before![k]), to: short(after![k]) }]),
          )
        : {},
  };
}
