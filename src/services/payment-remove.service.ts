import {
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice } from "@/lib/format";
import {
  planRemove,
  type RemoveBill,
  type RemoveBillState,
  type RemovePayment,
} from "@/lib/payment-remove";
import type { Payment } from "@/types/models";
import { col, COLLECTIONS } from "./firestore.service";
import type { Deleter } from "./recycle-bin.service";

/**
 * A payment entered by mistake, removed by the owner from the member's Payments list: kept in the
 * Recycle Bin (Undo / Restore puts it and its bill back exactly), its bill shows the money as not
 * paid again. Which entries can go: lib/payment-remove.ts.
 */

const removeFacts = (d: DocumentData): RemovePayment => ({
  amount: Number(d["amount"] ?? 0),
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

/** The payment's plans here; one no longer here counts as cancelled. */
function planRefs(d: DocumentData) {
  return [
    d["membershipId"] ? doc(db, COLLECTIONS.memberships, String(d["membershipId"])) : null,
    d["ptAssignmentId"] ? doc(db, COLLECTIONS.ptAssignments, String(d["ptAssignmentId"])) : null,
  ].filter((r): r is NonNullable<typeof r> => !!r);
}
const planFacts = (snaps: { exists: () => boolean; data: () => DocumentData | undefined }[]) =>
  snaps.map((s) =>
    s.exists()
      ? {
          status: String(s.data()?.["status"] ?? ""),
          cancelId: String(s.data()?.["cancelId"] ?? ""),
        }
      : { status: "cancelled", cancelId: "" },
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
  const plan = planRemove(removeFacts(payData), bill, planFacts(planSnaps));
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

/** Removes it (to the Recycle Bin) and fixes its bill, all at once. Returns the bin entry's id. */
export async function removePayment(p: Payment, by: Deleter): Promise<string> {
  const payRef = doc(db, COLLECTIONS.payments, p.id);
  const binRef = doc(col(COLLECTIONS.recycleBin));
  const itemRef = doc(col(COLLECTIONS.recycleBinItems));
  const first = (await getDoc(payRef)).data();
  if (!first) throw new Error("That payment was already removed.");
  const refs = planRefs(first);
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
    const plan = planRemove(removeFacts(d), bill, planFacts(planSnaps));
    if (plan.error) throw new Error(plan.error);
    const now = serverTimestamp();
    const amount = Number(d["amount"] ?? 0);
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
        ...(plan.bill ? { billBefore: plan.bill.before, billAfter: plan.bill.after } : {}),
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
    tx.delete(payRef);
  });
  return binRef.id;
}

/** Undo / Restore: the payment comes back and its bill reads as before (if not changed since). */
export async function putBackPayment(binId: string, viewer: { owner: boolean; uid: string }) {
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
  const payRef = doc(db, COLLECTIONS.payments, payId);
  await runTransaction(db, async (tx) => {
    const entry = await tx.get(binRef);
    if (!entry.exists()) throw new Error("It is no longer in the Recycle Bin.");
    const x = (entry.data()["extra"] ?? {}) as {
      invoiceId?: string;
      billBefore?: RemoveBillState;
      billAfter?: RemoveBillState;
    };
    if ((await tx.get(payRef)).exists()) throw new Error("That payment is already back.");
    const billRef = x.invoiceId && x.billBefore ? doc(db, COLLECTIONS.invoices, x.invoiceId) : null;
    const bill = billRef ? await tx.get(billRef) : null;
    if (billRef && x.billBefore && x.billAfter) {
      if (!bill?.exists()) throw new Error("Its bill is no longer here: it can't be put back.");
      const cur = billFacts(bill.data());
      if (
        Math.abs(cur.amountPaid - x.billAfter.amountPaid) > 0.005 ||
        cur.paymentStatus !== x.billAfter.paymentStatus
      )
        throw new Error(
          `Bill ${cur.invoiceNumber} was changed after the payment was removed: collect it again instead.`,
        );
      const now = serverTimestamp();
      tx.update(billRef, { ...billPatch(x.billBefore), updatedAt: now });
      const token = String(bill.data()["publicToken"] ?? "");
      if (token)
        tx.update(doc(db, COLLECTIONS.publicInvoices, token), {
          ...publicPatch(x.billBefore),
          updatedAt: now,
        });
    }
    tx.set(payRef, item.data()["data"] as DocumentData);
    items.docs.forEach((d) => tx.delete(d.ref));
    tx.delete(binRef);
  });
  return 1;
}
