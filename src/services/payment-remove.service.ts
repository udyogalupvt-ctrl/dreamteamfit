import {
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  planRemove,
  type RemoveBill,
  type RemoveBillState,
  type RemovePayment,
} from "@/lib/payment-remove";
import type { Payment } from "@/types/models";
import { cashOpenFrom } from "./finance.service";
import { col, COLLECTIONS } from "./firestore.service";
import type { Deleter } from "./recycle-bin.service";

/**
 * A payment entered by mistake, removed by the owner from the member's Payments list: kept in the
 * Recycle Bin (Undo / Restore puts it and its bill back exactly), its bill shows the money as not
 * paid again. Which entries can go: lib/payment-remove.ts.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const removeFacts = (d: DocumentData): RemovePayment => ({
  amount: Number(d["amount"] ?? 0),
  paymentDate: String(d["paymentDate"] ?? ""),
  kind: String(d["kind"] ?? ""),
  oldSoftware: d["oldSoftware"] === true,
  invoiceId: String(d["invoiceId"] ?? ""),
  trainerShareAmount: Number(d["trainerShareAmount"] ?? 0),
  cancelId: String(d["cancelId"] ?? ""),
});

const billFacts = (d: DocumentData): RemoveBill => ({
  invoiceNumber: String(d["invoiceNumber"] ?? ""),
  total: Number(d["total"] ?? 0),
  amountPaid: Number(d["amountPaid"] ?? 0),
  balanceDue: Number(d["balanceDue"] ?? 0),
  paymentStatus: String(d["paymentStatus"] ?? ""),
  closedAmount: Number(d["closedAmount"] ?? 0),
  cancelId: String(d["cancelId"] ?? ""),
  beforeCancel: (d["beforeCancel"] as RemoveBill["beforeCancel"] | undefined) ?? null,
});

/** The payment's plans here. */
function planRefs(d: DocumentData) {
  return [
    d["membershipId"] ? doc(db, COLLECTIONS.memberships, String(d["membershipId"])) : null,
    d["ptAssignmentId"] ? doc(db, COLLECTIONS.ptAssignments, String(d["ptAssignmentId"])) : null,
  ].filter((r): r is NonNullable<typeof r> => !!r);
}
type Snap = { exists: () => boolean; data: () => DocumentData | undefined };
const planFacts = (snaps: Snap[]) =>
  snaps.map((s) =>
    s.exists()
      ? {
          status: String(s.data()?.["status"] ?? ""),
          cancelId: String(s.data()?.["cancelId"] ?? ""),
        }
      : { status: "missing", cancelId: "" },
  );

const billPatch = (s: RemoveBillState) => ({
  amountPaid: s.amountPaid,
  balanceDue: s.balanceDue,
  paymentStatus: s.paymentStatus,
  closedAmount: s.closedAmount ?? deleteField(),
  cancelId: s.cancelId ?? deleteField(),
  beforeCancel: s.beforeCancel ?? deleteField(),
});
const publicPatch = (s: RemoveBillState) => ({
  amountPaid: s.amountPaid,
  balanceDue: s.balanceDue,
  paymentStatus: s.paymentStatus,
});

/** For the confirm dialog: can it go, and what its bill becomes. */
export async function previewRemovePayment(p: Payment) {
  const payData = (await getDoc(doc(db, COLLECTIONS.payments, p.id))).data();
  if (!payData) return { error: "That payment was already removed.", line: "" };
  const [billSnap, ...planSnaps] = await Promise.all([
    p.invoiceId && !p.oldSoftware
      ? getDoc(doc(db, COLLECTIONS.invoices, p.invoiceId))
      : Promise.resolve(null),
    ...planRefs(payData).map((r) => getDoc(r)),
  ]);
  const bill = billSnap?.exists() ? billFacts(billSnap.data()) : null;
  const plan = planRemove(
    removeFacts(payData),
    bill,
    planFacts(planSnaps),
    cashOpenFrom(todayISO()),
  );
  const a = plan.bill?.after;
  const line = plan.error
    ? ""
    : !a || !bill
      ? `${formatPrice(Math.abs(p.amount))} ${p.amount < 0 ? "given back" : "paid"} on ${formatDateISO(p.paymentDate)} goes from Collected, income${p.oldSoftware ? "" : " and the Day Book"}.`
      : a.paymentStatus === "closed"
        ? `Bill ${bill.invoiceNumber} stays Closed (its plan is cancelled): nothing is asked for.`
        : `Bill ${bill.invoiceNumber} shows ${formatPrice(a.balanceDue)} due again.`;
  return { error: plan.error, line };
}

/** A plan's "paid in the old software" amount before and after the removal (kept in step). */
interface OldPaidStep {
  path: string;
  before: number;
  after: number;
}

/** Removes it (to the Recycle Bin) and fixes its bill, all at once. Returns the bin entry's id. */
export async function removePayment(p: Payment, by: Deleter): Promise<string> {
  const payRef = doc(db, COLLECTIONS.payments, p.id);
  const binRef = doc(col(COLLECTIONS.recycleBin));
  const itemRef = doc(col(COLLECTIONS.recycleBinItems));
  const first = (await getDoc(payRef)).data();
  if (!first) throw new Error("That payment was already removed.");
  const refs = planRefs(first);
  const openFrom = cashOpenFrom(todayISO());
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(payRef);
    if (!snap.exists()) throw new Error("That payment was already removed.");
    const d = snap.data();
    const billRef =
      d["invoiceId"] && d["oldSoftware"] !== true
        ? doc(db, COLLECTIONS.invoices, String(d["invoiceId"]))
        : null;
    const billSnap = billRef ? await tx.get(billRef) : null;
    const planSnaps = await Promise.all(refs.map((r) => tx.get(r)));
    const bill = billSnap?.exists() ? billFacts(billSnap.data()) : null;
    const plan = planRemove(removeFacts(d), bill, planFacts(planSnaps), openFrom);
    if (plan.error) throw new Error(plan.error);
    const now = serverTimestamp();
    const amount = Number(d["amount"] ?? 0);
    // Old-software money: its plan's "paid in the old software" goes down with it (a gym + PT plan
    // that were one old plan share the payment, so both do).
    const oldPaid: OldPaidStep[] =
      d["oldSoftware"] === true
        ? planSnaps
            .filter((s) => s.exists() && Number(s.data()?.["oldSoftwarePaid"] ?? 0) > 0)
            .map((s) => {
              const before = Number(s.data()?.["oldSoftwarePaid"] ?? 0);
              return { path: s.ref.path, before, after: Math.max(0, round(before - amount)) };
            })
        : [];
    tx.set(itemRef, {
      binId: binRef.id,
      n: 0,
      path: payRef.path,
      collection: COLLECTIONS.payments,
      docId: payRef.id,
      data: d,
      deletedByUid: by.uid,
      createdAt: now,
    });
    tx.set(binRef, {
      section: "bills",
      label: `Payment ${amount < 0 ? "−" : ""}${formatPrice(Math.abs(amount))} · ${String(d["clientNameSnapshot"] ?? "Member")}`,
      detail: [
        formatDateISO(String(d["paymentDate"] ?? "")),
        String(d["method"] ?? ""),
        d["oldSoftware"] === true
          ? "paid in the old software"
          : amount < 0
            ? "refund given back"
            : String(d["invoiceNumber"] ?? ""),
        "entered by mistake",
      ]
        .filter(Boolean)
        .join(" · "),
      count: 1,
      deletedBy: by.name,
      deletedByUid: by.uid,
      deletedByRole: by.role,
      deletedAt: now,
      extra: {
        kind: "payment",
        paymentId: payRef.id,
        invoiceId: billRef?.id ?? "",
        ...(plan.bill && bill
          ? { billBefore: plan.bill.before, billAfter: plan.bill.after, billTotal: bill.total }
          : {}),
        ...(oldPaid.length ? { oldPaid } : {}),
      },
    });
    if (plan.bill && billRef && billSnap?.exists()) {
      tx.update(billRef, { ...billPatch(plan.bill.after), updatedAt: now });
      const token = String(billSnap.data()["publicToken"] ?? "");
      if (token)
        tx.update(doc(db, COLLECTIONS.publicInvoices, token), {
          ...publicPatch(plan.bill.after),
          updatedAt: now,
        });
    }
    for (const o of oldPaid)
      tx.update(doc(db, o.path), { oldSoftwarePaid: o.after, updatedAt: now });
    tx.delete(payRef);
  });
  return binRef.id;
}

/**
 * Undo / Restore: the payment comes back and its bill (and its plan's "paid in the old software")
 * read as before, only when nothing changed them since; otherwise it is refused (collect again).
 */
export async function putBackPayment(
  binId: string,
  viewer: { owner: boolean; uid: string },
  byName: string,
) {
  const binRef = doc(db, COLLECTIONS.recycleBin, binId);
  const items = await getDocs(
    viewer.owner
      ? query(col(COLLECTIONS.recycleBinItems), where("binId", "==", binId))
      : query(
          col(COLLECTIONS.recycleBinItems),
          where("binId", "==", binId),
          where("deletedByUid", "==", viewer.uid),
        ),
  );
  const item = items.docs.find((x) => x.data()["collection"] === COLLECTIONS.payments);
  if (!item) throw new Error("It is no longer in the Recycle Bin.");
  const payId = String(item.data()["docId"] ?? "");
  if (!payId || payId.includes("/")) throw new Error("It is no longer in the Recycle Bin.");
  const data = item.data()["data"] as DocumentData;
  // A cancellation's refund: only while that cancellation still stands (Restore undid it?).
  const cancelId = String(data["cancelId"] ?? "");
  if (cancelId) {
    const [ms, ps] = await Promise.all([
      getDocs(query(col(COLLECTIONS.memberships), where("cancelId", "==", cancelId))),
      getDocs(query(col(COLLECTIONS.ptAssignments), where("cancelId", "==", cancelId))),
    ]);
    if (ms.empty && ps.empty)
      throw new Error(
        "The cancellation this refund belonged to was undone (the plan runs again): it can't come back.",
      );
  }
  const payRef = doc(db, COLLECTIONS.payments, payId);
  // Marked first, so the activity log says "Restored" (not "deleted forever").
  await updateDoc(binRef, { restoredBy: byName });
  await runTransaction(db, async (tx) => {
    const entry = await tx.get(binRef);
    if (!entry.exists()) throw new Error("It is no longer in the Recycle Bin.");
    const x = (entry.data()["extra"] ?? {}) as {
      invoiceId?: string;
      billBefore?: RemoveBillState;
      billAfter?: RemoveBillState;
      billTotal?: number;
      oldPaid?: OldPaidStep[];
    };
    if ((await tx.get(payRef)).exists()) throw new Error("That payment is already back.");
    const billRef = x.invoiceId && x.billBefore ? doc(db, COLLECTIONS.invoices, x.invoiceId) : null;
    const bill = billRef ? await tx.get(billRef) : null;
    const oldPaid = (x.oldPaid ?? []).filter(
      (o) => typeof o.path === "string" && /^(memberships|ptAssignments)\/[^/]+$/.test(o.path),
    );
    const plans = await Promise.all(oldPaid.map((o) => tx.get(doc(db, o.path))));
    if (billRef && x.billBefore && x.billAfter) {
      if (!bill?.exists()) throw new Error("Its bill is no longer here: it can't be put back.");
      const cur = billFacts(bill.data());
      // Its bill as the removal left it: same total, paid, due and status (else collect again).
      if (
        (typeof x.billTotal === "number" && Math.abs(cur.total - x.billTotal) > 0.005) ||
        Math.abs(cur.amountPaid - x.billAfter.amountPaid) > 0.005 ||
        Math.abs(cur.balanceDue - x.billAfter.balanceDue) > 0.005 ||
        cur.paymentStatus !== x.billAfter.paymentStatus
      )
        throw new Error(
          `Bill ${cur.invoiceNumber} was changed after the payment was removed: it can't be put back. Collect it again instead.`,
        );
    }
    oldPaid.forEach((o, i) => {
      const s = plans[i];
      if (s?.exists() && Math.abs(Number(s.data()["oldSoftwarePaid"] ?? 0) - o.after) > 0.005)
        throw new Error(
          "What was paid in the old software on its plan was changed since: change it with Edit plan instead.",
        );
    });
    const now = serverTimestamp();
    if (billRef && bill?.exists() && x.billBefore) {
      tx.update(billRef, { ...billPatch(x.billBefore), updatedAt: now });
      const token = String(bill.data()["publicToken"] ?? "");
      if (token)
        tx.update(doc(db, COLLECTIONS.publicInvoices, token), {
          ...publicPatch(x.billBefore),
          updatedAt: now,
        });
    }
    oldPaid.forEach((o, i) => {
      if (plans[i]?.exists())
        tx.update(doc(db, o.path), { oldSoftwarePaid: o.before, updatedAt: now });
    });
    tx.set(payRef, data);
    items.docs.forEach((d) => tx.delete(d.ref));
    tx.delete(binRef);
  });
  return 1;
}
