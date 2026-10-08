import {
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  diffOldRows,
  oldMoneySplit,
  oldRowsTotal,
  planOldBackfill,
  type OldBackfill,
  type OldPayMethod,
  type OldPayRow,
  type OldPlanFact,
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

/* ------------------------------------------------------------------ owner tool */

const RUN_KIND = "dates";

export interface OldMoneyPreview extends OldBackfill {
  /** Plans marked "paid in the old software" (gym + PT). */
  plans: number;
}

/** Reads every plan paid in the old software and works out what the tool would add. */
async function readBackfill(today = todayISO()) {
  const [gyms, pts, pays] = await Promise.all([
    getDocs(query(col(COLLECTIONS.memberships), where("paidInOldSoftware", "==", true))),
    getDocs(query(col(COLLECTIONS.ptAssignments), where("paidInOldSoftware", "==", true))),
    getDocs(query(col(COLLECTIONS.payments), where("oldSoftware", "==", true))),
  ]);
  const countedGym = new Set<string>();
  const countedPt = new Set<string>();
  pays.docs.forEach((d) => {
    const x = d.data();
    if (x["membershipId"]) countedGym.add(String(x["membershipId"]));
    if (x["ptAssignmentId"]) countedPt.add(String(x["ptAssignmentId"]));
  });
  // Members' names (gym plans don't keep one): only the ones needed, 30 per read.
  const need = [
    ...new Set(gyms.docs.map((d) => String(d.data()["clientId"] ?? "")).filter(Boolean)),
  ];
  const names = new Map<string, string>();
  for (let i = 0; i < need.length; i += 30) {
    const snap = await getDocs(
      query(col(COLLECTIONS.clients), where(documentId(), "in", need.slice(i, i + 30))),
    );
    snap.docs.forEach((d) => names.set(d.id, String(d.data()["fullName"] ?? "")));
  }
  pts.docs.forEach((d) => {
    const c = String(d.data()["clientId"] ?? "");
    if (c && !names.has(c)) names.set(c, String(d.data()["clientNameSnapshot"] ?? ""));
  });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const facts: OldPlanFact[] = [
    ...gyms.docs.map((d): OldPlanFact => {
      const x = d.data();
      return {
        kind: "gym",
        id: d.id,
        clientId: str(x["clientId"]),
        clientName: names.get(str(x["clientId"])) ?? "",
        name: str(x["packageNameSnapshot"]),
        startDate: str(x["startDate"]),
        status: str(x["status"]),
        paid: Number(x["oldSoftwarePaid"] ?? 0) || 0,
        billNo: str(x["oldSoftwareBillNo"]),
        enrollmentId: str(x["enrollmentId"]),
        invoiceId: str(x["invoiceId"]),
        price: Number(x["priceSnapshot"] ?? 0) || 0,
        trainerShare: 0,
        counted: countedGym.has(d.id),
      };
    }),
    ...pts.docs.map((d): OldPlanFact => {
      const x = d.data();
      return {
        kind: "pt",
        id: d.id,
        clientId: str(x["clientId"]),
        clientName: str(x["clientNameSnapshot"]) || (names.get(str(x["clientId"])) ?? ""),
        name: str(x["ptPackageNameSnapshot"]),
        startDate: str(x["startDate"]),
        status: str(x["status"]),
        paid: Number(x["oldSoftwarePaid"] ?? 0) || 0,
        billNo: str(x["oldSoftwareBillNo"]),
        enrollmentId: str(x["enrollmentId"]),
        invoiceId: str(x["invoiceId"]),
        price: Number(x["ptPrice"] ?? 0) || 0,
        trainerShare: Number(x["trainerShareAmount"] ?? 0) || 0,
        counted: countedPt.has(d.id),
      };
    }),
  ];
  return { plan: planOldBackfill(facts, today), plans: facts.length };
}

/** Owner tool preview: what "Count on the real dates" would add, month by month. */
export async function previewOldMoneyDates(): Promise<OldMoneyPreview> {
  const { plan, plans } = await readBackfill();
  return { ...plan, plans };
}

export interface OldMoneyRun {
  id: string;
  total: number;
  count: number;
  months: { month: string; amount: number; plans: number }[];
  by: string;
  at: Date | null;
  undone: boolean;
}

/**
 * Adds the old-software payment of every plan that has none yet, on its real date, in one go.
 * The run is kept (oldSoftwareMoves, kind "dates") with the payments it added, for Undo.
 */
export async function applyOldMoneyDates(input: {
  canFinance: boolean;
  by: { uid: string; name: string };
}) {
  if (!input.canFinance)
    throw new Error("This changes money: it needs the owner's login (Income & expenses).");
  const { plan } = await readBackfill();
  if (!plan.add.length) throw new Error("Nothing to add: every old-software plan is counted.");
  const runRef = doc(col(COLLECTIONS.oldSoftwareMoves));
  const refs = plan.add.map(() => doc(col(COLLECTIONS.payments)));
  // Firestore takes up to 500 writes at once (each write here also logs one line): 200 a time.
  for (let i = 0; i < plan.add.length; i += 200) {
    const batch = writeBatch(db);
    if (i === 0)
      batch.set(runRef, {
        kind: RUN_KIND,
        total: plan.total,
        count: plan.add.length,
        months: plan.months,
        paymentIds: refs.map((r) => r.id),
        by: input.by.name,
        byUid: input.by.uid,
        undone: false,
        createdAt: serverTimestamp(),
      });
    plan.add.slice(i, i + 200).forEach((a, j) =>
      batch.set(
        refs[i + j]!,
        oldPaymentData(
          { date: a.date, amount: a.amount, method: "Other" },
          {
            clientId: a.clientId,
            clientName: a.clientName,
            membershipId: a.membershipId,
            ptAssignmentId: a.ptAssignmentId,
            billNo: a.billNo,
            basis: { gym: null, pt: null },
          },
          true,
          input.by,
          // The split worked out for the plan(s) it pays for (gym, PT, or one old plan for both).
          { ...a.split, oldRunId: runRef.id },
        ),
      ),
    );
    await batch.commit();
  }
  return { runId: runRef.id, total: plan.total, count: plan.add.length };
}

/** The tool's last run (for its Undo), or null. */
export async function lastOldMoneyRun(): Promise<OldMoneyRun | null> {
  // Runs are few: no index needed for the newest one.
  const snap = await getDocs(
    query(col(COLLECTIONS.oldSoftwareMoves), where("kind", "==", RUN_KIND)),
  );
  const runs = snap.docs
    .map((d) => {
      const x = d.data();
      const at = x["createdAt"]?.toDate?.() ?? null;
      return {
        id: d.id,
        total: Number(x["total"] ?? 0),
        count: Number(x["count"] ?? 0),
        months: Array.isArray(x["months"]) ? x["months"] : [],
        by: String(x["by"] ?? ""),
        at: at as Date | null,
        undone: x["undone"] === true,
      };
    })
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return runs[0] ?? null;
}

/**
 * Undo of a run: takes off the payments it added that nobody changed since (a plan whose
 * old-software payments staff corrected keeps them).
 */
export async function undoOldMoneyDates(runId: string, canFinance: boolean) {
  if (!canFinance)
    throw new Error("This changes money: it needs the owner's login (Income & expenses).");
  const snap = await getDocs(query(col(COLLECTIONS.payments), where("oldRunId", "==", runId)));
  const untouched = snap.docs.filter(
    (d) =>
      isOldPayment(d.data()) && !(Array.isArray(d.data()["edits"]) && d.data()["edits"].length),
  );
  for (let i = 0; i < Math.max(1, untouched.length); i += 200) {
    const batch = writeBatch(db);
    untouched.slice(i, i + 200).forEach((d) => batch.delete(d.ref));
    if (i + 200 >= untouched.length)
      batch.update(doc(db, COLLECTIONS.oldSoftwareMoves, runId), {
        undone: true,
        undoneAt: serverTimestamp(),
        removed: untouched.length,
      });
    await batch.commit();
  }
  return { removed: untouched.length, kept: snap.size - untouched.length };
}
