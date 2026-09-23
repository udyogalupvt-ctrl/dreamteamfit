import { limit, orderBy, query, where, type DocumentData } from "firebase/firestore";
import { col, COLLECTIONS, subscribeQuery, toDate } from "./firestore.service";

/** One line of the server-written, read-only activity log. */
export interface AuditEntry {
  id: string;
  at: Date;
  collection: string;
  docId: string;
  action: "created" | "updated" | "deleted";
  summary: string;
  clientId: string;
  clientName: string;
  actorType: string;
  actorName: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export const mapAudit = (id: string, d: DocumentData): AuditEntry => ({
  id,
  at: toDate(d["at"]),
  collection: d["collection"] ?? "",
  docId: d["docId"] ?? "",
  action: d["action"] ?? "updated",
  summary: d["summary"] ?? "",
  clientId: d["clientId"] ?? "",
  clientName: d["clientName"] ?? "",
  actorType: d["actorType"] ?? "",
  actorName: d["actorName"] ?? "",
  changes: d["changes"] ?? {},
});

export const subscribeAuditLog = (
  max: number,
  ok: (x: AuditEntry[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.auditLogs), orderBy("at", "desc"), limit(max)),
    mapAudit,
    ok,
    fail,
  );

export const subscribeClientAudit = (
  clientId: string,
  ok: (x: AuditEntry[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.auditLogs), where("clientId", "==", clientId)),
    mapAudit,
    (x) => ok(x.sort((a, b) => b.at.getTime() - a.at.getTime())),
    fail,
  );

/** Groups for filtering, by the collection that changed. */
export const AUDIT_GROUPS = {
  money: ["invoices", "payments", "trainerPayouts", "expenses", "manualIncome"],
  plan: ["memberships", "ptAssignments", "enrollments"],
  calls: ["followups", "leadLogs", "inquiries"],
  entry: ["clients"],
  messages: ["whatsappMessages"],
  setup: ["packages", "ptPackages", "trainers", "biometricDevices", "settings"],
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;
export const auditGroupOf = (collection: string): AuditGroup | "other" =>
  (Object.entries(AUDIT_GROUPS).find(([, cols]) =>
    (cols as readonly string[]).includes(collection),
  )?.[0] as AuditGroup) ?? "other";
