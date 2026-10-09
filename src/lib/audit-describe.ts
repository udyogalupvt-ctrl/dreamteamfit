/** Human wording for the activity log. One sentence per change, or null when not worth logging. */

type D = Record<string, unknown>;
export type AuditAction = "created" | "updated" | "deleted";

/** Machine noise and derived records that would drown the log. */
export const AUDIT_SKIP = new Set([
  "auditLogs",
  "memberIds",
  "attendance",
  "memberVisits",
  "biometricCommands",
  "biometricTemplates",
  "whatsappWebhookEvents",
  "notifications",
  "automationActivities",
  "renewalNotifications",
  "birthdayNotifications",
  "absenceNotifications",
  "paymentDueNotifications",
  "publicInvoices",
  "expenseActivities",
  "importBatches",
  // The Recycle Bin's copies of deleted records (the bin entry itself is logged).
  "recycleBinItems",
]);
const NOISE = new Set([
  "updatedAt",
  "lastVisitDate",
  "createdAt",
  "lastSeenAt",
  "lastIp",
  "cmdSeq",
  "lastSyncAt",
  "lastDoorSyncDate",
  "pdfUrl",
  "phoneNormalized",
  "deviceAccessChangedAt",
  "entryChangedAt",
  "entryChangedBy",
  "followupId",
  "publicToken",
  "lastWhatsappMessageAt",
  "deliveredAt",
  "readAt",
]);

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-25" → "25 Sep 2026"; anything else as it is. */
const day = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(v));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : s(v);
};
const STATUS: Record<string, string> = {
  biometric_pending: "waiting for first thumb",
  pending: "starts later",
  expired: "ended",
};
/** Plan / PT status in plain words. */
const st = (v: unknown) => STATUS[s(v)] ?? s(v).replace(/_/g, " ");
const WA_KIND: Record<string, string> = {
  invoice: "bill",
  payment_due: "payment reminder",
  renewal: "renewal reminder",
  birthday: "birthday wish",
  absence: "missed-you message",
  member_app: "member app link",
  test: "test message",
  follow_up: "message",
};
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
      if (f.length === 1 && f[0] === "portalSentAt") return "Member app link sent to the member";
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
        return `Plan added: ${s(d["packageNameSnapshot"])}, ${day(d["startDate"])} → ${day(d["endDate"])} (${st(d["status"])})`;
      if (action === "deleted") return `Plan deleted: ${s(d["packageNameSnapshot"])}`;
      if (f.includes("status"))
        return `Plan ${s(d["packageNameSnapshot"])}: ${st(b["status"])} → ${st(a["status"])}`;
      if (f.includes("upgradedTo"))
        return `Plan ${s(d["packageNameSnapshot"])} upgraded: ended ${day(a["endDate"])}, ${money(a["upgradeCredit"])} credit for unused days`;
      if (f.includes("pauses")) {
        const before = Array.isArray(b["pauses"]) ? b["pauses"].length : 0;
        const list = Array.isArray(a["pauses"]) ? (a["pauses"] as D[]) : [];
        const last = list[list.length - 1];
        return list.length > before && last
          ? `Plan ${s(d["packageNameSnapshot"])} paused ${s(last["days"])} days from ${day(last["on"])} (${s(last["reason"])}): now ends ${day(a["endDate"])}`
          : `Pause undone on ${s(d["packageNameSnapshot"])}: ends ${day(a["endDate"])} again`;
      }
      if (f.includes("startDate") || f.includes("endDate"))
        return `Plan ${s(d["packageNameSnapshot"])} dates: ${day(a["startDate"])} → ${day(a["endDate"])}`;
      return null;
    case "invoices":
      if (action === "created")
        return `Bill ${s(d["invoiceNumber"])}: ${money(d["total"])}, paid ${money(d["amountPaid"])}`;
      if (action === "deleted")
        return `Bill deleted: ${s(d["invoiceNumber"])} (${money(d["total"])})`;
      if (f.includes("cancelledDue") && !f.includes("amountPaid"))
        return Number(a["cancelledDue"] ?? 0) > Number(b["cancelledDue"] ?? 0)
          ? `Bill ${s(d["invoiceNumber"])}: a plan on it was cancelled, ${money(Number(a["cancelledDue"] ?? 0) - Number(b["cancelledDue"] ?? 0))} of it no longer asked for; ${money(a["balanceDue"])} still due`
          : `Bill ${s(d["invoiceNumber"])}: the cancelled plan's part is asked for again (plan restored); ${money(a["balanceDue"])} due`;
      if (became(f, b, a, "paymentStatus", "closed"))
        return `Bill ${s(d["invoiceNumber"])}: ${money(a["closedAmount"])} still due is no longer asked for (plan cancelled)`;
      if (b["paymentStatus"] === "closed" && f.includes("paymentStatus"))
        return `Bill ${s(d["invoiceNumber"])}: ${money(a["balanceDue"])} due is asked for again (plan restored)`;
      if (f.includes("amountPaid"))
        return `Bill ${s(d["invoiceNumber"])}: paid ${money(b["amountPaid"])} → ${money(a["amountPaid"])}`;
      return f.some((k) => !["paymentStatus", "balanceDue", "paymentsTracked"].includes(k))
        ? `Bill ${s(d["invoiceNumber"])} edited: ${f.join(", ")}`
        : null;
    case "payments":
      // A refund is a payment of minus the amount given back.
      if (Number(d["amount"]) < 0)
        return action === "created"
          ? `Refund ${money(-Number(d["amount"]))} given back by ${s(d["method"])}${d["note"] ? ` (${s(d["note"])})` : ""}`
          : `Refund ${money(-Number(d["amount"]))} ${action === "deleted" ? "removed" : "edited"}`;
      if (d["oldSoftware"] === true && action !== "updated")
        return `Paid in the old software ${action === "deleted" ? "removed" : "counted"}: ${money(d["amount"])} on ${s(d["paymentDate"])}`;
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
        ? `PT ${s(d["ptPackageNameSnapshot"])}: ${st(b["status"])} → ${st(a["status"])}`
        : null;
    case "workoutAssignments":
    case "dietAssignments": {
      const what = col === "workoutAssignments" ? "Workout" : "Diet";
      if (action === "created")
        return `${what} plan given: ${s(d["planNameSnapshot"])}${d["assignedByName"] ? ` (by ${s(d["assignedByName"])})` : ""}`;
      if (f.includes("status"))
        return `${what} plan ${s(d["planNameSnapshot"])}: ${s(b["status"])} → ${s(a["status"])}`;
      return null;
    }
    case "trainerPayouts":
      if (action === "created")
        return d["adjustment"]
          ? `Trainer deduction: ${s(d["trainerNameSnapshot"])} ${money(-Number(d["trainerShareAmount"]))} off the next payout (PT refunded)`
          : `Trainer share due: ${s(d["trainerNameSnapshot"])} ${money(d["trainerShareAmount"])}`;
      if (!f.includes("status") && f.includes("trainerShareAmount"))
        return `Trainer share ${s(d["trainerNameSnapshot"])}: ${money(b["trainerShareAmount"])} → ${money(a["trainerShareAmount"])}`;
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
        return `Call planned for ${day(d["followUpDate"])} ${s(d["followUpTime"])}: ${s(d["nextAction"] || d["reason"])}`;
      if (became(f, b, a, "status", "completed"))
        return `Call done: ${s(a["outcome"]) || "completed"}`;
      if (f.includes("followUpDate"))
        return `Call moved to ${day(a["followUpDate"])} ${s(a["followUpTime"])}`;
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
      // One line per announcement (below), not one per person.
      if (d["type"] === "announcement") return null;
      if (
        action === "created" ||
        (f.includes("status") && ["sent", "failed"].includes(s(a["status"])))
      )
        return action === "created"
          ? `WhatsApp ${WA_KIND[s(d["type"])] ?? s(d["type"])} to ${s(d["clientNameSnapshot"]) || s(d["normalizedPhone"])}`
          : `WhatsApp ${WA_KIND[s(d["type"])] ?? s(d["type"])} ${a["status"] === "sent" ? "sent" : "not sent"}${d["errorMessage"] ? `: ${s(d["errorMessage"])}` : ""}`;
      return null;
    case "announcements":
      return action === "created"
        ? `WhatsApp announcement to ${s(d["total"])} people: ${s(d["message"])}`
        : null;
    case "memberCalls":
      return `Call · ${s(d["clientNameSnapshot"])} (${s(d["segment"])}): ${s(d["status"]).replace(/_/g, " ")}${d["notes"] ? ` — ${s(d["notes"])}` : ""}`;
    case "expenses":
      return `Expense ${action}: ${s(d["title"])} ${money(d["amount"])}`;
    case "manualIncome":
      return `Other income ${action}: ${s(d["title"])} ${money(d["amount"])}`;
    case "cashDays": {
      // The doc id is the day of the cash.
      const list = (x: D) => (Array.isArray(x["handovers"]) ? (x["handovers"] as D[]) : []);
      const ids = (x: D) => new Set(list(x).map((h) => s(h["id"])));
      const added = list(a).filter((h) => !ids(b).has(s(h["id"])));
      const removed = list(b).filter((h) => !ids(a).has(s(h["id"])));
      const lines = [
        ...added.map(
          (h) =>
            `Cash handover ${money(h["amount"])}${h["to"] ? ` → ${s(h["to"])}` : ""} from the cash of ${day(d["__date"])}${s(h["givenOn"]) && h["givenOn"] !== d["__date"] ? ` (given ${day(h["givenOn"])})` : ""}`,
        ),
        ...removed.map(
          (h) =>
            `Cash handover removed: ${money(h["amount"])} from the cash of ${day(d["__date"])}`,
        ),
      ];
      if (f.includes("openingOverride"))
        lines.push(
          a["openingOverride"] === null || a["openingOverride"] === undefined
            ? `Opening cash of ${day(d["__date"])} cleared`
            : `Opening cash of ${day(d["__date"])} set to ${money(a["openingOverride"])}`,
        );
      return lines.length ? lines.join("; ") : null;
    }
    case "packages":
    case "ptPackages":
      return `${col === "packages" ? "Gym" : "PT"} package ${action}: ${s(d["name"])} ${money(d["price"])}${action === "updated" ? ` (${f.join(", ")})` : ""}`;
    case "trainers":
      return `Trainer ${action}: ${s(d["name"])}${action === "updated" ? ` (${f.join(", ")})` : ""}`;
    case "biometricDevices":
      return `Fingerprint device ${action}: ${s(d["name"])}${action === "updated" ? ` (${f.join(", ")})` : ""}`;
    case "cfoSettings": {
      // What changed, never the amounts (the opening money stays out of the log).
      const parts = [
        f.some((k) => k === "openingBalance" || k === "openingDate") ? "opening money" : "",
        f.some((k) =>
          [
            "atRiskDays",
            "renewalDays",
            "newMemberMinVisits",
            "ptMinVisits",
            "runwayWarnMonths",
            "graceDays",
          ].includes(k),
        )
          ? "alert limits"
          : "",
        f.some((k) => k === "aiEnabled" || k === "language") ? "AI summary" : "",
      ].filter(Boolean);
      if (action === "created") return "CFO settings saved";
      return parts.length ? `CFO settings changed: ${parts.join(", ")}` : null;
    }
    case "recycleBin":
      if (action === "created") return `Moved to Recycle Bin: ${s(d["label"])}`;
      if (action === "deleted")
        return b["restoredBy"]
          ? `Restored from Recycle Bin: ${s(d["label"])}`
          : `Deleted forever from Recycle Bin: ${s(d["label"])}`;
      return null;
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
  // Cash days are keyed by their date: the wording needs it.
  const dated = (x: D | null) => (col === "cashDays" ? { ...(x ?? {}), __date: docId } : (x ?? {}));
  const summary =
    col === "settings"
      ? `Settings changed (${docId}): ${f.join(", ") || action}`
      : describe(col, action, dated(before), dated(after), f);
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
      // CFO settings hold the gym's money: the log says what changed, not the values.
      action === "updated" && col !== "cfoSettings"
        ? Object.fromEntries(
            f.slice(0, 12).map((k) => [k, { from: short(before![k]), to: short(after![k]) }]),
          )
        : {},
  };
}
