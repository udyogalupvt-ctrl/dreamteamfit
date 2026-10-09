import { format } from "date-fns";
import {
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type Transaction,
  type WriteBatch,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  pickCurrent,
  planRemoval,
  type RemovalFacts,
  type RemovalPlan,
  type RmBill,
  type RmPayment,
  type RmPayout,
  type RmPlan,
} from "@/lib/plan-remove";
import type { Client } from "@/types/models";
import { cashOpenFrom } from "./finance.service";
import { col, COLLECTIONS, type CollectionName } from "./firestore.service";
import type { Deleter } from "./recycle-bin.service";

/**
 * A gym or PT plan added by mistake, removed as if it was never added: the whole sale (its plans,
 * bill, payments, refunds, trainer share and joining record) goes to the Recycle Bin in one write,
 * and plans the sale changed come back as they were. Undo / Restore puts it all back
 * (restoreFromBin, with afterPlanRestore). Which records go: lib/plan-remove.ts.
 */

type Kind = "gym" | "pt";
type Snap = DocumentSnapshot<DocumentData>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => Number(v ?? 0) || 0;
const dayOf = (v: unknown) =>
  v instanceof Timestamp
    ? format(v.toDate(), "yyyy-MM-dd")
    : v instanceof Date
      ? format(v, "yyyy-MM-dd")
      : "";

const planOf = (kind: Kind, s: Snap): RmPlan => {
  const d = s.data() ?? {};
  return {
    kind,
    id: s.id,
    name: str(kind === "gym" ? d["packageNameSnapshot"] : d["ptPackageNameSnapshot"]),
    status: str(d["status"]),
    startDate: str(d["startDate"]),
    endDate: str(d["endDate"]),
    invoiceId: str(d["invoiceId"]),
    enrollmentId: str(d["enrollmentId"]),
    cancelId: str(d["cancelId"]),
    soldOn: dayOf(d["createdAt"]),
    upgradedTo: str(d["upgradedTo"]),
    originalEndDate: str(d["originalEndDate"]),
    endedBy: str(d["endedBy"]),
  };
};
const billOf = (s: Snap): RmBill => {
  const d = s.data() ?? {};
  return {
    id: s.id,
    invoiceNumber: str(d["invoiceNumber"]),
    membershipId: str(d["membershipId"]),
    ptAssignmentId: str(d["ptAssignmentId"]),
    enrollmentId: str(d["enrollmentId"]),
    publicToken: str(d["publicToken"]),
    total: num(d["total"]),
    upgradeCredit: num(d["upgradeCredit"]),
  };
};
const paymentOf = (s: Snap): RmPayment => {
  const d = s.data() ?? {};
  return {
    id: s.id,
    amount: num(d["amount"]),
    paymentDate: str(d["paymentDate"]),
    method: str(d["method"]),
    kind: str(d["kind"]),
    oldSoftware: d["oldSoftware"] === true,
    invoiceId: str(d["invoiceId"]),
    membershipId: str(d["membershipId"]),
    ptAssignmentId: str(d["ptAssignmentId"]),
    cancelId: str(d["cancelId"]),
  };
};
const payoutOf = (s: Snap): RmPayout => {
  const d = s.data() ?? {};
  return {
    id: s.id,
    trainerName: str(d["trainerNameSnapshot"]),
    ptAssignmentId: str(d["ptAssignmentId"]),
    invoiceId: str(d["invoiceId"]),
    cancelId: str(d["cancelId"]),
    status: str(d["status"]),
    trainerShareAmount: num(d["trainerShareAmount"]),
  };
};

/** Everything of the member's that a removal looks at. */
interface MemberDocs {
  client: Snap;
  gyms: Snap[];
  pts: Snap[];
  bills: Snap[];
  payments: Snap[];
  /** null = this login can't read the trainers' pay list. */
  payouts: Snap[] | null;
}

async function loadMember(clientId: string): Promise<MemberDocs> {
  const of = (name: CollectionName) => getDocs(query(col(name), where("clientId", "==", clientId)));
  const [client, gyms, pts, bills, payments, payouts] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.clients, clientId)),
    of(COLLECTIONS.memberships),
    of(COLLECTIONS.ptAssignments),
    of(COLLECTIONS.invoices),
    of(COLLECTIONS.payments),
    of(COLLECTIONS.trainerPayouts).catch(() => null),
  ]);
  return {
    client,
    gyms: gyms.docs,
    pts: pts.docs,
    bills: bills.docs,
    payments: payments.docs,
    payouts: payouts?.docs ?? null,
  };
}

/** The same records read again inside the transaction (gone ones left out). */
async function reread(tx: Transaction, m: MemberDocs): Promise<MemberDocs> {
  const again = async (list: Snap[]) =>
    (await Promise.all(list.map((s) => tx.get(s.ref)))).filter((s) => s.exists());
  const [client, gyms, pts, bills, payments, payouts] = await Promise.all([
    tx.get(m.client.ref),
    again(m.gyms),
    again(m.pts),
    again(m.bills),
    again(m.payments),
    m.payouts ? again(m.payouts) : Promise.resolve(null),
  ]);
  return { client, gyms, pts, bills, payments, payouts };
}

function factsOf(m: MemberDocs, target: { kind: Kind; id: string }): RemovalFacts {
  const today = todayISO();
  const c = m.client.data() ?? {};
  const current = c["currentMembership"] as { membershipId?: unknown } | null | undefined;
  return {
    target,
    plans: [...m.gyms.map((s) => planOf("gym", s)), ...m.pts.map((s) => planOf("pt", s))],
    bills: m.bills.map(billOf),
    payments: m.payments.map(paymentOf),
    payouts: (m.payouts ?? []).map(payoutOf),
    client: { currentId: str(current?.membershipId), enrollmentId: str(c["enrollmentId"]) },
    today,
    openFrom: cashOpenFrom(today),
  };
}

const NO_PAYOUTS =
  "This login can't see the trainers' pay list, so it can't remove a PT plan: ask the owner.";

function decide(m: MemberDocs, target: { kind: Kind; id: string }): RemovalPlan {
  const plan = planRemoval(factsOf(m, target));
  if (!plan.error && m.payouts === null && plan.plans.some((p) => p.kind === "pt"))
    return { ...plan, error: NO_PAYOUTS };
  return plan;
}

/** For the confirm dialog: what goes, what comes back, what the money does, or why it can't. */
export async function previewRemovePlan(client: Pick<Client, "id">, kind: Kind, planId: string) {
  return decide(await loadMember(client.id), { kind, id: planId });
}

/** Removes the sale (to the Recycle Bin) and puts back what it changed, all at once. */
export async function removePlan(
  client: Pick<Client, "id" | "fullName">,
  kind: Kind,
  planId: string,
  by: Deleter,
): Promise<string> {
  const first = await loadMember(client.id);
  const early = decide(first, { kind, id: planId });
  if (early.error) throw new Error(early.error);
  const binRef = doc(col(COLLECTIONS.recycleBin));
  await runTransaction(db, async (tx) => {
    const m = await reread(tx, first);
    const plan = decide(m, { kind, id: planId });
    if (plan.error) throw new Error(plan.error);
    const pick = (list: Snap[], ids: string[]) => list.filter((s) => ids.includes(s.id));
    const planSnap = new Map<string, Snap>([
      ...m.gyms.map((s): [string, Snap] => [`gym:${s.id}`, s]),
      ...m.pts.map((s): [string, Snap] => [`pt:${s.id}`, s]),
    ]);
    const salePlans = plan.plans.flatMap((p) => {
      const s = planSnap.get(`${p.kind}:${p.id}`);
      return s ? [{ ...p, s }] : [];
    });
    const extras = await Promise.all([
      ...plan.publicTokens.map((t) => tx.get(doc(db, COLLECTIONS.publicInvoices, t))),
      ...plan.enrollmentIds.map((id) => tx.get(doc(db, COLLECTIONS.enrollments, id))),
    ]);
    // The chosen plan first, then what belongs to it.
    const goes = [
      ...new Map(
        [
          ...salePlans.map((p) => p.s),
          ...pick(m.bills, plan.billIds),
          ...pick(m.payments, plan.paymentIds),
          ...pick(m.payouts ?? [], plan.payoutIds),
          ...extras.filter((s) => s.exists()),
        ].map((s) => [s.ref.path, s]),
      ).values(),
    ];
    // Plans the sale changed: kept as they were, so a restore writes them back.
    const changed = pick(
      m.gyms,
      plan.putBack.map((p) => p.id),
    );
    const now = serverTimestamp();
    let n = 0;
    for (const s of [...goes, ...changed])
      tx.set(doc(col(COLLECTIONS.recycleBinItems)), {
        binId: binRef.id,
        n: n++,
        path: s.ref.path,
        collection: s.ref.parent.id,
        docId: s.id,
        data: s.data() ?? {},
        deletedByUid: by.uid,
        createdAt: now,
      });
    const names = salePlans
      .map((p) => `${p.kind === "pt" ? "PT: " : ""}${planOf(p.kind, p.s).name}`)
      .join(" + ");
    const enrollmentId = str(m.client.data()?.["enrollmentId"]);
    tx.set(binRef, {
      section: "plans",
      label: `Plan: ${names} · ${client.fullName}`,
      detail: [
        ...pick(m.bills, plan.billIds).map((s) => str(s.data()?.["invoiceNumber"])),
        "added by mistake",
      ]
        .filter(Boolean)
        .join(" · "),
      count: goes.length,
      deletedBy: by.name,
      deletedByUid: by.uid,
      deletedByRole: by.role,
      deletedAt: now,
      extra: {
        kind: "plan",
        clientId: client.id,
        plans: plan.plans.map((p) => `${p.kind}:${p.id}`),
        changed: plan.putBack.map((p) => p.id),
        enrollmentId: plan.clearEnrollment ? enrollmentId : "",
      },
    });
    for (const s of goes) tx.delete(s.ref);
    for (const b of plan.putBack)
      tx.update(doc(db, COLLECTIONS.memberships, b.id), {
        status: b.status,
        endDate: b.endDate,
        ...Object.fromEntries(b.clear.map((k) => [k, deleteField()])),
        updatedAt: now,
      });
    const patch: Record<string, unknown> = {};
    if (plan.current) {
      patch["currentMembership"] = plan.current.summary;
      if (plan.current.active) patch["status"] = "active";
    }
    // Their thumb registration must not look for a joining record that is gone.
    if (plan.clearEnrollment) patch["enrollmentId"] = null;
    if (m.client.exists() && Object.keys(patch).length)
      tx.update(m.client.ref, { ...patch, updatedAt: now });
    // Plan writes queue the door check themselves (lib/firestore).
  });
  return binRef.id;
}

/**
 * Before a removed plan comes back: refused when its money is now in a closed Day Book month
 * (those days are carried forward and must not change).
 */
export function checkPlanRestore(items: { collection: string; data: DocumentData }[]) {
  const openFrom = cashOpenFrom(todayISO());
  const closed = items.find(
    (i) =>
      i.collection === COLLECTIONS.payments &&
      i.data["oldSoftware"] !== true &&
      str(i.data["paymentDate"]) < openFrom,
  );
  if (closed)
    throw new Error(
      `${formatPrice(Math.abs(num(closed.data["amount"])))} on ${formatDateISO(str(closed.data["paymentDate"]))} is now in a closed Day Book month: it can't come back.`,
    );
}

/**
 * After a removed plan came back (its records written back): the member's current plan is worked
 * out again, and their joining record link put back.
 */
export async function afterPlanRestore(b: WriteBatch, extra: Record<string, unknown>) {
  const clientId = str(extra["clientId"]);
  if (!clientId) return;
  const ref = doc(db, COLLECTIONS.clients, clientId);
  const [c, ms] = await Promise.all([
    getDoc(ref),
    getDocs(query(col(COLLECTIONS.memberships), where("clientId", "==", clientId))),
  ]);
  if (!c.exists()) return;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const touched = new Set([
    ...list(extra["plans"])
      .filter((k) => k.startsWith("gym:"))
      .map((k) => k.slice(4)),
    ...list(extra["changed"]),
  ]);
  const cm = c.data()["currentMembership"] as { membershipId?: unknown } | null | undefined;
  const current = str(cm?.membershipId);
  const patch: Record<string, unknown> = {};
  if (current ? touched.has(current) : touched.size > 0) {
    const p = pickCurrent(
      ms.docs.map((s) => planOf("gym", s)),
      todayISO(),
    );
    patch["currentMembership"] = p.summary;
    if (p.active) patch["status"] = "active";
  }
  const enrollmentId = str(extra["enrollmentId"]);
  if (enrollmentId && !c.data()["enrollmentId"]) patch["enrollmentId"] = enrollmentId;
  if (Object.keys(patch).length) b.update(ref, { ...patch, updatedAt: serverTimestamp() });
}
