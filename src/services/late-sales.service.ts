import {
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, todayISO } from "@/lib/format";
import {
  dateSetByHand,
  LATE_TOOL,
  lateUndoable,
  planLateSales,
  type LateMove,
  type LatePlan,
  type LateSaleFact,
} from "@/lib/late-sales";
import type { RecordEdit } from "@/types/models";
import { cashOpenFrom } from "./finance.service";
import { col, COLLECTIONS, type CollectionName } from "./firestore.service";

/**
 * Owner tool (Income & expenses): joining payments typed in after their plan started move to the
 * plan's first day (src/lib/late-sales.ts). Each move is the owner's normal "change the payment
 * date" correction: the payment keeps its bill, amount and mode, gets a correction line, and the
 * Day Book shows it on its new day (cash in the drawer today stays the same). The run is kept in
 * oldSoftwareMoves (kind "late-dates") for Undo.
 */

const RUN_KIND = "late-dates";
const REASON = "Typed in after the plan started: counted on the plan's first day";
/** Payments per transaction (each also writes an activity-log line; 500 writes at most). */
const CHUNK = 100;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

async function byIds(name: CollectionName, ids: string[]) {
  const out = new Map<string, DocumentData>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await getDocs(
      query(col(name), where(documentId(), "in", unique.slice(i, i + 30))),
    );
    snap.docs.forEach((d) => out.set(d.id, d.data()));
  }
  return out;
}

/** Every joining payment from the 1st of last month on, with its plan and bill. */
async function readLate(today: string): Promise<LatePlan & { openFrom: string }> {
  const openFrom = cashOpenFrom(today);
  const [pays, days] = await Promise.all([
    getDocs(query(col(COLLECTIONS.payments), where("paymentDate", ">=", openFrom))),
    // Days whose opening cash was typed in the Day Book (its first day, corrections).
    getDocs(query(col(COLLECTIONS.cashDays), where(documentId(), ">=", openFrom))),
  ]);
  const openingDays = days.docs
    .filter((d) => typeof d.data()["openingOverride"] === "number")
    .map((d) => d.id);
  const joining = pays.docs.filter((d) => {
    const x = d.data();
    return x["kind"] === "initial" && Number(x["amount"]) > 0 && x["oldSoftware"] !== true;
  });
  const [gyms, pts, bills] = await Promise.all([
    byIds(
      COLLECTIONS.memberships,
      joining.map((d) => str(d.data()["membershipId"])),
    ),
    byIds(
      COLLECTIONS.ptAssignments,
      joining.map((d) => str(d.data()["ptAssignmentId"])),
    ),
    byIds(
      COLLECTIONS.invoices,
      joining.map((d) => str(d.data()["invoiceId"])),
    ),
  ]);
  const facts = joining.map((d): LateSaleFact => {
    const x = d.data();
    const gym = gyms.get(str(x["membershipId"]));
    const pt = pts.get(str(x["ptAssignmentId"]));
    const bill = bills.get(str(x["invoiceId"]));
    const plan = gym ?? pt;
    return {
      paymentId: d.id,
      clientId: str(x["clientId"]),
      clientName: str(x["clientNameSnapshot"]),
      plan: [
        gym ? str(gym["packageNameSnapshot"]) : "",
        pt ? `PT: ${str(pt["ptPackageNameSnapshot"])}` : "",
      ]
        .filter(Boolean)
        .join(" + "),
      startDate: str(plan?.["startDate"]),
      planStatus: str(plan?.["status"]),
      paidInOldSoftware: gym?.["paidInOldSoftware"] === true || pt?.["paidInOldSoftware"] === true,
      paymentDate: str(x["paymentDate"]),
      amount: Number(x["amount"]) || 0,
      method: str(x["method"]),
      kind: str(x["kind"]),
      oldSoftware: x["oldSoftware"] === true,
      invoiceId: str(x["invoiceId"]),
      invoiceNumber: str(x["invoiceNumber"]),
      billStatus: bill ? str(bill["paymentStatus"]) : "missing",
      upgradeCredit: Number(bill?.["upgradeCredit"] ?? 0) || 0,
      dateSetByHand:
        x["paidToday"] === true || dateSetByHand(Array.isArray(x["edits"]) ? x["edits"] : []),
    };
  });
  return { ...planLateSales(facts, openFrom, openingDays), openFrom };
}

/** Owner tool preview: which payments move, and where. Nothing changes. */
export function previewLateSales() {
  return readLate(todayISO());
}

export interface LateRun {
  id: string;
  total: number;
  count: number;
  by: string;
  at: Date | null;
  undone: boolean;
}

/**
 * Moves the chosen payments (the preview's `move` rows the owner left ticked) to their plan's first
 * day. Each one is checked again first: a payment changed since the preview is left as it is.
 */
export async function applyLateSales(input: {
  paymentIds: string[];
  canFinance: boolean;
  by: { uid: string; name: string };
}) {
  if (!input.canFinance)
    throw new Error("This changes money: it needs the owner's login (Income & expenses).");
  const today = todayISO();
  const plan = await readLate(today);
  const wanted = new Set(input.paymentIds);
  const chosen = plan.move.filter((m) => wanted.has(m.paymentId));
  if (!chosen.length) throw new Error("Nothing to move: check the list again.");
  const runRef = doc(col(COLLECTIONS.oldSoftwareMoves));
  const moved: LateMove[] = [];
  let changed = 0;
  for (let i = 0; i < chosen.length; i += CHUNK) {
    const part = chosen.slice(i, i + CHUNK);
    const res = await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(
        part.map((m) => tx.get(doc(db, COLLECTIONS.payments, m.paymentId))),
      );
      const ok: LateMove[] = [];
      snaps.forEach((s, k) => {
        const m = part[k]!;
        const x = s.data();
        if (
          !s.exists() ||
          !x ||
          x["paymentDate"] !== m.from ||
          !same(Number(x["amount"]), m.amount) ||
          x["oldSoftware"] === true
        )
          return;
        const edit: RecordEdit = {
          on: today,
          by: input.by.name,
          reason: REASON,
          changes: [`Date ${formatDateISO(m.from)} → ${formatDateISO(m.to)}`],
          tool: LATE_TOOL,
        };
        tx.update(s.ref, {
          paymentDate: m.to,
          // Cash past a typed Day Book opening stays in the drawer on the day it was typed in.
          ...(m.cashOn ? { cashDate: m.cashOn } : {}),
          edits: [...(Array.isArray(x["edits"]) ? x["edits"] : []), edit],
          lateRunId: runRef.id,
          updatedAt: serverTimestamp(),
        });
        ok.push(m);
      });
      const all = [...moved, ...ok];
      // The run lists what really moved (each part adds its own).
      tx.set(runRef, {
        kind: RUN_KIND,
        items: all.map((m) => ({
          paymentId: m.paymentId,
          from: m.from,
          to: m.to,
          amount: m.amount,
          clientName: m.clientName,
          ...(m.cashOn ? { cashOn: m.cashOn } : {}),
        })),
        total: Math.round(all.reduce((n, m) => n + m.amount, 0) * 100) / 100,
        count: all.length,
        by: input.by.name,
        byUid: input.by.uid,
        undone: false,
        createdAt: serverTimestamp(),
      });
      return { ok, changed: part.length - ok.length };
    });
    moved.push(...res.ok);
    changed += res.changed;
  }
  return {
    runId: runRef.id,
    count: moved.length,
    total: Math.round(moved.reduce((n, m) => n + m.amount, 0) * 100) / 100,
    changed,
  };
}

/** The tool's last run (for its Undo), or null. */
export async function lastLateRun(): Promise<LateRun | null> {
  // Runs are few: no index needed for the newest one.
  const snap = await getDocs(
    query(col(COLLECTIONS.oldSoftwareMoves), where("kind", "==", RUN_KIND)),
  );
  const runs = snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        total: Number(x["total"] ?? 0),
        count: Number(x["count"] ?? 0),
        by: str(x["by"]),
        at: (x["createdAt"]?.toDate?.() ?? null) as Date | null,
        undone: x["undone"] === true,
      };
    })
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return runs[0] ?? null;
}

/**
 * Undo of a run: each payment goes back to the day it was typed in, unless it was changed since
 * (its date or amount) or that day is now in a month the Day Book has carried forward.
 */
export async function undoLateSales(
  runId: string,
  input: { canFinance: boolean; by: { uid: string; name: string } },
) {
  if (!input.canFinance)
    throw new Error("This changes money: it needs the owner's login (Income & expenses).");
  const today = todayISO();
  const openFrom = cashOpenFrom(today);
  const runRef = doc(db, COLLECTIONS.oldSoftwareMoves, runId);
  const run = await getDoc(runRef);
  if (!run.exists() || run.data()["kind"] !== RUN_KIND) throw new Error("This run was not found.");
  if (run.data()["undone"] === true) throw new Error("This run was already taken back.");
  const items = (Array.isArray(run.data()["items"]) ? run.data()["items"] : []) as {
    paymentId: string;
    from: string;
    to: string;
  }[];
  let restored = 0;
  for (let i = 0; i < Math.max(1, items.length); i += CHUNK) {
    const part = items.slice(i, i + CHUNK);
    const last = i + CHUNK >= items.length;
    restored += await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(
        part.map((m) => tx.get(doc(db, COLLECTIONS.payments, m.paymentId))),
      );
      let n = 0;
      snaps.forEach((s, k) => {
        const m = part[k]!;
        const x = s.exists() ? s.data() : null;
        if (
          !x ||
          x["lateRunId"] !== runId ||
          m.from < openFrom ||
          m.to < openFrom ||
          !lateUndoable(m, { paymentDate: str(x["paymentDate"]), amount: Number(x["amount"]) })
        )
          return;
        const edit: RecordEdit = {
          on: today,
          by: input.by.name,
          reason: "Undo: back to the day it was typed in",
          changes: [`Date ${formatDateISO(m.to)} → ${formatDateISO(m.from)}`],
          tool: LATE_TOOL,
        };
        tx.update(s.ref, {
          paymentDate: m.from,
          ...(x["cashDate"] !== undefined ? { cashDate: deleteField() } : {}),
          edits: [...(Array.isArray(x["edits"]) ? x["edits"] : []), edit],
          lateRunId: "",
          updatedAt: serverTimestamp(),
        });
        n += 1;
      });
      if (last)
        tx.update(runRef, {
          undone: true,
          undoneAt: serverTimestamp(),
          undoneBy: input.by.name,
          restored: restored + n,
        });
      return n;
    });
  }
  return { restored, kept: items.length - restored };
}
