import {
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  type DocumentData,
  type DocumentReference,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  diffOldRows,
  oldMoneySplit,
  oldPartnerOf,
  oldRowsTotal,
  type OldPayMethod,
  type OldPayRow,
  type OldSplitBasis,
} from "@/lib/old-money";
import type { RecordEdit } from "@/types/models";
import { col, COLLECTIONS } from "./firestore.service";

/**
 * Old-software money as payment records on the day it was paid there (see src/lib/old-money.ts):
 * `oldSoftware: true`, no bill here (`invoiceId: ""`), linked to the plan(s). Counted in Collected
 * / month totals / CFO by date; left out of the Day Book drawer, incentives and trainer payouts.
 * They are changed only through the plan (Edit plan / Edit PT plan), never as a normal payment.
 */

/** Who / what an old-software payment belongs to. */
export interface OldPayLink {
  clientId: string;
  clientName: string;
  membershipId: string | null;
  ptAssignmentId: string | null;
  /** The old software's bill number, when known. */
  billNo: string;
  basis: OldSplitBasis;
}

export interface OldRowDoc {
  id: string;
  data: DocumentData;
}

/** A transaction or a batch (both write the same way). */
interface Writer {
  set(ref: DocumentReference, data: DocumentData): unknown;
  update(ref: DocumentReference, data: DocumentData): unknown;
  delete(ref: DocumentReference): unknown;
}

export const isOldPayment = (d: DocumentData | undefined) => d?.["oldSoftware"] === true;

export const rowOf = (r: OldRowDoc): OldPayRow => ({
  id: r.id,
  date: String(r.data["paymentDate"] ?? ""),
  amount: Number(r.data["amount"] ?? 0),
  method: (r.data["method"] ?? "Other") as OldPayMethod,
});

const sortRows = (rows: OldPayRow[]) =>
  [...rows].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

/** The payment record for one row (a new one). */
export function oldPaymentData(
  row: OldPayRow,
  link: OldPayLink,
  first: boolean,
  by: { uid: string; name: string },
  extra: Record<string, unknown> = {},
) {
  const now = serverTimestamp();
  return {
    clientId: link.clientId,
    clientNameSnapshot: link.clientName,
    invoiceId: "",
    invoiceNumber: "",
    membershipId: link.membershipId,
    ptAssignmentId: link.ptAssignmentId,
    amount: row.amount,
    method: row.method,
    paymentDate: row.date,
    kind: first ? "initial" : "balance",
    oldSoftware: true,
    oldSoftwareBillNo: link.billNo.slice(0, 40),
    ...oldMoneySplit(row.amount, link.basis),
    createdBy: by.name,
    createdByUid: by.uid,
    // Sold in the old software: no incentive here.
    counsellorId: "",
    counsellorName: "",
    note: "Paid in the old software",
    edits: [],
    ...extra,
    createdAt: now,
    updatedAt: now,
  };
}

/** The old-software payments of one plan (gym or PT), as saved. */
export async function readOldRows(kind: "gym" | "pt", planId: string): Promise<OldRowDoc[]> {
  const snap = await getDocs(
    query(
      col(COLLECTIONS.payments),
      where(kind === "gym" ? "membershipId" : "ptAssignmentId", "==", planId),
    ),
  );
  return snap.docs.filter((d) => isOldPayment(d.data())).map((d) => ({ id: d.id, data: d.data() }));
}

/** "₹3,000 on 12-08-2026 + ₹2,800 on 20-08-2026". */
export const describeOldRows = (rows: OldPayRow[]) =>
  rows.length
    ? sortRows(rows)
        .map((r) => `${formatPrice(r.amount)} on ${formatDateISO(r.date)}`)
        .join(" + ")
    : "none";

/**
 * Saves a plan's old-software payments in a transaction (after its reads) or a batch:
 * `existing` = its records as read (checked by the caller), `next` = the rows wanted. Rows kept
 * are updated in place (with an edit line), new rows are added, missing ones removed. Any row of
 * a plan that staff changed is no longer the owner tool's to undo.
 */
export function writeOldRows(
  tx: Writer,
  existing: OldRowDoc[],
  next: OldPayRow[],
  link: OldPayLink,
  by: { uid: string; name: string },
  reason: string,
) {
  const diff = diffOldRows(existing.map(rowOf), next);
  if (!diff.changed) return diff;
  const firstDate = sortRows(next)[0]?.date ?? "";
  const firstId = sortRows(next)[0]?.id;
  const now = serverTimestamp();
  const changed = new Map(diff.update.map((u) => [u.id, u.row] as const));
  const removed = new Set(diff.remove);
  for (const e of existing) {
    if (removed.has(e.id)) continue;
    const r = changed.get(e.id);
    const edit: RecordEdit | null = r
      ? {
          on: todayISO(),
          by: by.name,
          reason: reason.slice(0, 300),
          changes: [`${describeOldRows([rowOf(e)])} → ${describeOldRows([r])} (${r.method})`],
        }
      : null;
    tx.update(doc(db, COLLECTIONS.payments, e.id), {
      ...(r
        ? {
            amount: r.amount,
            method: r.method,
            paymentDate: r.date,
            ...oldMoneySplit(r.amount, link.basis),
            edits: [...(Array.isArray(e.data["edits"]) ? e.data["edits"] : []), edit],
          }
        : {}),
      kind: e.id === firstId ? "initial" : "balance",
      oldRunId: "",
      updatedAt: now,
    });
  }
  let firstUsed = !!firstId;
  for (const r of diff.add) {
    const first = !firstUsed && r.date === firstDate;
    if (first) firstUsed = true;
    tx.set(doc(col(COLLECTIONS.payments)), oldPaymentData(r, link, first, by));
  }
  for (const id of diff.remove) tx.delete(doc(db, COLLECTIONS.payments, id));
  return diff;
}

/** New split of a plan's old-software payments after its price / trainer share changed. */
export function resplitOldRows(tx: Writer, recs: OldRowDoc[], basis: OldSplitBasis) {
  const now = serverTimestamp();
  for (const r of recs)
    tx.update(doc(db, COLLECTIONS.payments, r.id), {
      ...oldMoneySplit(Number(r.data["amount"] ?? 0), basis),
      updatedAt: now,
    });
}

/** The plan's edit line for its old-software payments. */
export const oldRowsChange = (before: OldPayRow[], after: OldPayRow[]) =>
  before.length
    ? `Paid in the old software: ${describeOldRows(before)} (${formatPrice(oldRowsTotal(before))}) → ${describeOldRows(after)} (${formatPrice(oldRowsTotal(after))})`
    : `Paid in the old software: ${describeOldRows(after)}, counted on ${after.length > 1 ? "those days" : "that day"}`;

/** A plan's other half when it was one old plan ("PT + floor"): see oldPartnerOf. */
export interface OldPartner {
  id: string;
  /** Gym partner: its package price. PT partner: its PT price. */
  price: number;
  trainerShare: number;
  oldSoftwarePaid: number;
  /** The partner already has old-software payments of its own. */
  hasRows: boolean;
}

const factOf = (id: string, x: DocumentData) => ({
  id,
  clientId: String(x["clientId"] ?? ""),
  enrollmentId: String(x["enrollmentId"] ?? ""),
  invoiceId: String(x["invoiceId"] ?? ""),
  paid: Number(x["oldSoftwarePaid"] ?? 0) || 0,
});

/**
 * For a plan with no old-software payments yet: the other plan of the same old plan, if any (gym
 * plan → its PT plan; PT plan → its gym plan), so its money is counted once and split by both.
 */
export async function findOldPartner(
  kind: "gym" | "pt",
  planId: string,
): Promise<OldPartner | null> {
  const mine = await getDoc(
    doc(db, kind === "gym" ? COLLECTIONS.memberships : COLLECTIONS.ptAssignments, planId),
  );
  if (!mine.exists()) return null;
  const me = factOf(planId, mine.data());
  const snap = await getDocs(
    query(
      col(kind === "gym" ? COLLECTIONS.ptAssignments : COLLECTIONS.memberships),
      where("clientId", "==", me.clientId),
    ),
  );
  const others = snap.docs.filter((d) => d.data()["paidInOldSoftware"] === true);
  const hit =
    kind === "gym"
      ? others.find((d) => oldPartnerOf(factOf(d.id, d.data()), [me]))
      : (() => {
          const g = oldPartnerOf(
            me,
            others.map((d) => factOf(d.id, d.data())),
          );
          return g ? others.find((d) => d.id === g.id) : undefined;
        })();
  if (!hit) return null;
  const x = hit.data();
  return {
    id: hit.id,
    price: Number(kind === "gym" ? x["ptPrice"] : x["priceSnapshot"]) || 0,
    trainerShare: kind === "gym" ? Number(x["trainerShareAmount"] ?? 0) || 0 : 0,
    oldSoftwarePaid: Number(x["oldSoftwarePaid"] ?? 0) || 0,
    hasRows: (await readOldRows(kind === "gym" ? "pt" : "gym", hit.id)).length > 0,
  };
}
