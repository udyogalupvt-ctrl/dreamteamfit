import { doc, query, serverTimestamp, where, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type { FollowUpPriority, InquiryStatus, LeadLog } from "@/types/models";
import { col, COLLECTIONS, subscribeQuery, toDate } from "./firestore.service";

export const mapLeadLog = (id: string, d: DocumentData): LeadLog => ({
  id, inquiryId: d["inquiryId"] ?? null, clientId: d["clientId"] ?? "", customerSaid: d["customerSaid"] ?? "", response: d["response"] ?? "",
  nextAction: d["nextAction"] ?? "", nextCallDate: d["nextCallDate"] ?? "", nextCallTime: d["nextCallTime"] ?? "", expectedJoinDate: d["expectedJoinDate"] ?? "",
  expectedVisitDate: d["expectedVisitDate"] ?? "", priority: d["priority"] ?? "medium", notes: d["notes"] ?? "", createdBy: d["createdBy"] ?? "",
  createdAt: toDate(d["createdAt"]), updatedAt: toDate(d["updatedAt"]),
});

export const subscribeLeadLogs = (field: "inquiryId" | "clientId", id: string, ok: (x: LeadLog[]) => void, fail: (e: Error) => void) =>
  subscribeQuery(query(col(COLLECTIONS.leadLogs), where(field, "==", id)), mapLeadLog, (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())), fail);

export type LeadLogInput = Omit<LeadLog, "id" | "createdAt" | "updatedAt">;

const statusFor = (response: string, expectedJoin: string): InquiryStatus | null => {
  if (response === "Not Interested" || response === "Wrong Number") return "lost";
  if (expectedJoin || response === "Will Join Later") return "expected_to_join";
  if (response === "Interested" || response === "Will Visit") return "interested";
  return "contacted";
};

/**
 * Appends an immutable timeline entry (never overwrites history), updates the lead's
 * summary fields, closes the current pending follow-up and schedules the next one.
 */
export async function recordLeadFollowUp(input: LeadLogInput, ctx: { name: string; phone: string; currentFollowUpId?: string | null }) {
  const batch = writeBatch(db), now = serverTimestamp(), today = todayISO();
  batch.set(doc(col(COLLECTIONS.leadLogs)), { ...input, createdAt: now, updatedAt: now });
  if (input.inquiryId) {
    const status = statusFor(input.response, input.expectedJoinDate);
    batch.update(doc(db, COLLECTIONS.inquiries, input.inquiryId), {
      lastContactDate: today, nextFollowUpDate: input.nextCallDate || null, expectedJoinDate: input.expectedJoinDate || null,
      expectedVisitDate: input.expectedVisitDate || null, ...(status ? { status } : {}), updatedAt: now,
    });
  }
  if (ctx.currentFollowUpId) {
    batch.set(doc(db, COLLECTIONS.followups, ctx.currentFollowUpId), { status: "completed", outcome: input.response, lastContactDate: today, updatedAt: now }, { merge: true });
  }
  if (input.nextCallDate) {
    batch.set(doc(col(COLLECTIONS.followups)), {
      clientId: input.clientId, inquiryId: input.inquiryId, clientNameSnapshot: ctx.name, phoneSnapshot: ctx.phone, source: input.inquiryId ? "inquiry" : "general",
      reason: input.nextAction || "Follow-up call", notes: input.customerSaid, followUpDate: input.nextCallDate, followUpTime: input.nextCallTime || "10:00",
      status: "pending", priority: input.priority as FollowUpPriority, assignedTo: input.createdBy, lastContactDate: today, nextAction: input.nextAction,
      outcome: "", automated: false, parentFollowUpId: ctx.currentFollowUpId ?? null, createdAt: now, updatedAt: now,
    });
  }
  await batch.commit();
}
