import {
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import type { FollowUpPriority, InquiryStatus, LeadLog } from "@/types/models";
import { col, COLLECTIONS, subscribeQuery, toDate } from "./firestore.service";

export const mapLeadLog = (id: string, d: DocumentData): LeadLog => ({
  id,
  inquiryId: d["inquiryId"] ?? null,
  clientId: d["clientId"] ?? "",
  customerSaid: d["customerSaid"] ?? "",
  response: d["response"] ?? "",
  nextAction: d["nextAction"] ?? "",
  nextCallDate: d["nextCallDate"] ?? "",
  nextCallTime: d["nextCallTime"] ?? "",
  expectedJoinDate: d["expectedJoinDate"] ?? "",
  expectedVisitDate: d["expectedVisitDate"] ?? "",
  priority: d["priority"] ?? "medium",
  notes: d["notes"] ?? "",
  createdBy: d["createdBy"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeLeadLogs = (
  field: "inquiryId" | "clientId",
  id: string,
  ok: (x: LeadLog[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.leadLogs), where(field, "==", id)),
    mapLeadLog,
    (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    fail,
  );

export type LeadLogInput = Omit<LeadLog, "id" | "createdAt" | "updatedAt">;

/** One live "next call" per lead; every conversation is kept in the lead timeline. */
export const leadFollowUpId = (inquiryId: string) => `inquiry_${inquiryId}`;

/**
 * Records one call: appends an immutable timeline entry, updates the lead, completes the
 * call that was due and schedules the next one (if any). Never leaves two pending calls.
 */
export async function recordLeadFollowUp(
  input: LeadLogInput & { status: InquiryStatus | null },
  ctx: { name: string; phone: string; currentFollowUpId?: string | null },
) {
  const { status, ...log } = input;
  const today = todayISO();
  const pendingForLead = log.inquiryId
    ? (
        await getDocs(query(col(COLLECTIONS.followups), where("inquiryId", "==", log.inquiryId)))
      ).docs.filter((d) => d.data()["status"] === "pending")
    : [];
  const batch = writeBatch(db),
    now = serverTimestamp();
  batch.set(doc(col(COLLECTIONS.leadLogs)), { ...log, createdAt: now, updatedAt: now });

  const next = log.nextCallDate
    ? {
        clientId: log.clientId,
        inquiryId: log.inquiryId,
        clientNameSnapshot: ctx.name,
        phoneSnapshot: ctx.phone,
        source: log.inquiryId ? "inquiry" : "general",
        reason: log.nextAction || "Follow-up call",
        notes: log.customerSaid,
        followUpDate: log.nextCallDate,
        followUpTime: log.nextCallTime || "10:00",
        status: "pending",
        priority: log.priority as FollowUpPriority,
        assignedTo: log.createdBy,
        lastContactDate: today,
        nextAction: log.nextAction,
        outcome: "",
        automated: false,
        parentFollowUpId: ctx.currentFollowUpId ?? null,
        updatedAt: now,
      }
    : null;

  if (log.inquiryId) {
    batch.update(doc(db, COLLECTIONS.inquiries, log.inquiryId), {
      lastContactDate: today,
      nextFollowUpDate: log.nextCallDate || null,
      expectedJoinDate: log.expectedJoinDate || null,
      expectedVisitDate: log.expectedVisitDate || null,
      ...(status ? { status } : {}),
      updatedAt: now,
    });
    const stableId = leadFollowUpId(log.inquiryId);
    pendingForLead
      .filter((d) => d.id !== stableId)
      .forEach((d) =>
        batch.update(d.ref, {
          status: "completed",
          outcome: log.response,
          lastContactDate: today,
          updatedAt: now,
        }),
      );
    const stableRef = doc(db, COLLECTIONS.followups, stableId);
    if (next) batch.set(stableRef, { ...next, createdAt: now }, { merge: true });
    else if (pendingForLead.some((d) => d.id === stableId))
      batch.update(stableRef, {
        status: "completed",
        outcome: log.response,
        lastContactDate: today,
        updatedAt: now,
      });
  } else {
    if (ctx.currentFollowUpId)
      batch.set(
        doc(db, COLLECTIONS.followups, ctx.currentFollowUpId),
        { status: "completed", outcome: log.response, lastContactDate: today, updatedAt: now },
        { merge: true },
      );
    if (next) batch.set(doc(col(COLLECTIONS.followups)), { ...next, createdAt: now });
  }
  await batch.commit();
}
