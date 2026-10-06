/**
 * The CFO's reads: loads the gym's records with the queries listed in CFO_PLAN.md section 6 and
 * turns them into the plain CfoInput the pure maths in src/lib/cfo works on.
 *
 * Rules (the live project has no composite indexes, and reads cost money):
 *  - every query uses ONE field (one equality, one range, or one orderBy + limit);
 *  - no filtered aggregates (count / sum with a where);
 *  - getAll runs in chunks of 300;
 *  - every document read is counted (an empty query counts as 1, like Firestore bills it).
 * Every document is normalised defensively: a missing or odd field gets a safe default.
 */
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";
import type {
  CfoBill,
  CfoBillStatus,
  CfoExpense,
  CfoGymPlan,
  CfoGymPlanStatus,
  CfoInput,
  CfoMember,
  CfoOtherIncome,
  CfoPause,
  CfoPayment,
  CfoPayout,
  CfoPtPlan,
  CfoPtStatus,
  CfoSettings,
  CfoTrainer,
  ISODate,
} from "@/lib/cfo/types";
import { reportWindow } from "@/lib/cfo/index";
import { db, localDate } from "./admin";

type Snap = FirebaseFirestore.DocumentSnapshot;
type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ normalisers */

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): ISODate | "" => (typeof v === "string" && ISO.test(v) ? v : "");
const isoOrNull = (v: unknown): ISODate | null => iso(v) || null;
const idOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const rec = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

/** A Firestore Timestamp (or Date / ISO text) as an IST date, like localDate(). */
function istDate(v: unknown): ISODate | "" {
  const t = v as { toDate?: () => Date } | null;
  if (t && typeof t.toDate === "function") {
    const d = t.toDate();
    return Number.isNaN(d.getTime()) ? "" : localDate(d);
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : localDate(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : localDate(d);
  }
  return "";
}

const plusDays = (day: ISODate, n: number): ISODate => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const BILL_STATUSES = ["paid", "partial", "pending", "refunded", "closed"] as const;
const GYM_STATUSES = ["active", "expired", "cancelled", "pending", "biometric_pending"] as const;
const PT_STATUSES = ["pending", "active", "completed", "cancelled"] as const;
const PAYMENT_KINDS = ["initial", "balance", "refund"] as const;
const PAYOUT_STATUSES = ["pending", "paid", "cancelled"] as const;

function pauses(v: unknown): CfoPause[] {
  if (!Array.isArray(v)) return [];
  const out: CfoPause[] = [];
  for (const p of v) {
    const on = iso(rec(p)["on"]);
    const days = num(rec(p)["days"]);
    if (on && days > 0) out.push({ on, days });
  }
  return out;
}

function bill(s: Snap): CfoBill {
  const d = s.data() ?? {};
  const balanceDue = num(d["balanceDue"]);
  const items = Array.isArray(d["items"]) ? (d["items"] as unknown[]) : [];
  return {
    id: s.id,
    number: str(d["invoiceNumber"]),
    clientId: str(d["clientId"]),
    clientName: str(d["clientNameSnapshot"]),
    clientPhone: str(d["clientPhoneSnapshot"]),
    invoiceDate: iso(d["invoiceDate"]) || istDate(d["createdAt"]),
    dueDate: iso(d["dueDate"]),
    subtotal: num(d["subtotal"]),
    discount: num(d["discount"]),
    tax: num(d["tax"]),
    total: num(d["total"]),
    amountPaid: num(d["amountPaid"]),
    balanceDue,
    closedAmount: num(d["closedAmount"]),
    status: pick<CfoBillStatus>(
      d["paymentStatus"],
      BILL_STATUSES,
      balanceDue > 0 ? "pending" : "paid",
    ),
    membershipId: idOrNull(d["membershipId"]),
    ptAssignmentId: idOrNull(d["ptAssignmentId"]),
    membershipGross: num(d["membershipGross"]),
    ptGross: num(d["ptGross"]),
    upgradeCredit: num(d["upgradeCredit"]),
    paymentsTracked: Boolean(d["paymentsTracked"]),
    itemNames: items.map((i) => str(rec(i)["name"])).filter(Boolean),
  };
}

function gymPlan(s: Snap): CfoGymPlan {
  const d = s.data() ?? {};
  return {
    id: s.id,
    clientId: str(d["clientId"]),
    packageName: str(d["packageNameSnapshot"]),
    listPrice: num(d["priceSnapshot"]),
    startDate: iso(d["startDate"]),
    endDate: iso(d["endDate"]),
    originalEndDate: isoOrNull(d["originalEndDate"]),
    upgradeCredit: num(d["upgradeCredit"]),
    status: pick<CfoGymPlanStatus>(d["status"], GYM_STATUSES, "expired"),
    cancelledOn: isoOrNull(d["cancelledOn"]),
    cancelId: idOrNull(d["cancelId"]),
    invoiceId: idOrNull(d["invoiceId"]),
    pauses: pauses(d["pauses"]),
    paidInOldSoftware: d["paidInOldSoftware"] === true,
    imported: d["source"] === "import",
    upgradedTo: idOrNull(d["upgradedTo"]),
    upgradeFrom: isoOrNull(d["upgradeFrom"]),
    createdOn: istDate(d["createdAt"]),
  };
}

function ptPlan(s: Snap): CfoPtPlan {
  const d = s.data() ?? {};
  return {
    id: s.id,
    clientId: str(d["clientId"]),
    trainerId: str(d["trainerId"]),
    trainerName: str(d["trainerNameSnapshot"]),
    packageName: str(d["ptPackageNameSnapshot"]),
    listPrice: num(d["ptPrice"]),
    trainerShareAmount: num(d["trainerShareAmount"]),
    startDate: iso(d["startDate"]),
    endDate: iso(d["endDate"]),
    status: pick<CfoPtStatus>(d["status"], PT_STATUSES, "completed"),
    cancelledOn: isoOrNull(d["cancelledOn"]),
    cancelId: idOrNull(d["cancelId"]),
    invoiceId: idOrNull(d["invoiceId"]),
    paidInOldSoftware: d["paidInOldSoftware"] === true,
    createdOn: istDate(d["createdAt"]),
  };
}

function payout(s: Snap): CfoPayout {
  const d = s.data() ?? {};
  const share = num(d["trainerShareAmount"]);
  const before = rec(d["beforeCancel"])["trainerShareAmount"];
  return {
    id: s.id,
    ptAssignmentId: str(d["ptAssignmentId"]),
    trainerId: str(d["trainerId"]),
    trainerShareAmount: share,
    originalShare: typeof before === "number" && Number.isFinite(before) ? before : share,
    status: pick(d["status"], PAYOUT_STATUSES, "pending"),
    paidAt: isoOrNull(d["paidAt"]),
    adjustment: d["adjustment"] === true,
    date: iso(d["paymentDate"]) || istDate(d["createdAt"]),
  };
}

function payment(s: Snap): CfoPayment {
  const d = s.data() ?? {};
  return {
    id: s.id,
    amount: num(d["amount"]),
    paymentDate: iso(d["paymentDate"]) || istDate(d["createdAt"]),
    kind: pick(d["kind"], PAYMENT_KINDS, "initial"),
    cancelId: idOrNull(d["cancelId"]),
    invoiceId: str(d["invoiceId"]),
  };
}

function expense(s: Snap): CfoExpense {
  const d = s.data() ?? {};
  const paidBy = str(d["paidBy"]).trim();
  const byGym = paidBy === "" || paidBy.toLowerCase() === "gym";
  return {
    id: s.id,
    amount: num(d["amount"]),
    date: iso(d["date"]),
    category: str(d["category"]) || "Other",
    paidByGym: byGym,
    // The app writes settled:true for gym-paid expenses; an old record without the field too.
    settled: byGym ? true : d["settled"] === true,
    settledDate: isoOrNull(d["settledDate"]),
  };
}

function otherIncome(s: Snap): CfoOtherIncome {
  const d = s.data() ?? {};
  return {
    id: s.id,
    amount: num(d["amount"]),
    date: iso(d["date"]),
    category: str(d["category"]),
  };
}

function member(s: Snap): CfoMember {
  const d = s.data() ?? {};
  const lastVisitDate = iso(d["lastVisitDate"]);
  return {
    id: s.id,
    name: str(d["fullName"]),
    phone: str(d["phone"]),
    code: str(d["clientCode"]),
    joinedOn: iso(d["joinedOn"]) || istDate(d["createdAt"]),
    lastVisitDate,
    thumbSince: iso(d["thumbSince"]),
    tracked: d["firstThumbRegistered"] === true || lastVisitDate !== "",
  };
}

/* ------------------------------------------------------------------------ reads */

const MEMBER_FIELDS = [
  "fullName",
  "phone",
  "clientCode",
  "joinedOn",
  "createdAt",
  "lastVisitDate",
  "thumbSince",
  "firstThumbRegistered",
];

/** Settings → the opening day, "" when the cash balance is not set. */
const openingDay = (s: CfoSettings): ISODate | "" =>
  s.openingBalance !== null ? iso(s.openingDate) : "";

const minDay = (a: ISODate, b: ISODate | "") => (b && b < a ? b : a);

/**
 * Loads everything the maths needs. `readCount` is the number of documents read, for the
 * report and the Firestore bill.
 */
export async function loadCfoInput(
  settings: CfoSettings,
  today: ISODate,
): Promise<{ input: CfoInput; readCount: number }> {
  const firestore = db();
  const win = reportWindow(today);
  const D = openingDay(settings);
  let readCount = 0;

  /** A single-field query; counts what it read. */
  const run = async (q: FirebaseFirestore.Query) => {
    const snap = await q.get();
    readCount += Math.max(1, snap.size);
    return snap.docs;
  };
  /** getAll in chunks of 300; the returned snapshots include "missing" ones (exists false). */
  const getAll = async (refs: DocumentReference[], fields?: string[]) => {
    const out: Snap[] = [];
    for (let i = 0; i < refs.length; i += 300) {
      const chunk = refs.slice(i, i + 300);
      const got = fields
        ? await firestore.getAll(...chunk, { fieldMask: fields })
        : await firestore.getAll(...chunk);
      readCount += chunk.length;
      out.push(...got);
    }
    return out;
  };
  const col = (name: string) => firestore.collection(name);

  const paymentsFrom = minDay(win.lastMonthStart, D);
  const moneyFrom = minDay(win.windowStart, D);

  /* wave 1: everything that needs no ids */
  const [
    gymLate,
    gymNoEnd,
    ptDocs,
    payoutDocs,
    billsByDate,
    billsOwing,
    billsOld,
    paymentsSince,
    refunds,
    expensesSince,
    expensesSettled,
    expensesOpen,
    firstExpense,
    incomeDocs,
    trainerDocs,
    ptPackageDocs,
  ] = await Promise.all([
    run(col("memberships").where("endDate", ">=", win.windowStart)),
    run(col("memberships").where("endDate", "==", "")),
    run(col("ptAssignments")),
    run(col("trainerPayouts")),
    run(col("invoices").where("invoiceDate", ">=", win.windowStart)),
    run(col("invoices").where("balanceDue", ">", 0)),
    run(col("invoices").where("paymentsTracked", "==", false)),
    run(col("payments").where("paymentDate", ">=", paymentsFrom)),
    run(col("payments").where("kind", "==", "refund")),
    run(col("expenses").where("date", ">=", moneyFrom)),
    D ? run(col("expenses").where("settledDate", ">=", D)) : Promise.resolve([]),
    // Staff-paid expenses still waiting to be paid back, whatever their date.
    run(col("expenses").where("settled", "==", false)),
    run(col("expenses").where("date", ">", "2000-01-01").orderBy("date").limit(1)),
    run(col("manualIncome").where("date", ">=", moneyFrom)),
    run(col("trainers")),
    run(col("ptPackages")),
  ]);

  const dedupe = (lists: Snap[][]) => {
    const seen = new Map<string, Snap>();
    for (const list of lists) for (const s of list) if (!seen.has(s.id)) seen.set(s.id, s);
    return [...seen.values()];
  };

  const gymSnaps = dedupe([gymLate, gymNoEnd]);
  const gymPlans = gymSnaps.map(gymPlan);
  const ptPlans = ptDocs.map(ptPlan);

  /* wave 2: bills of the plans (those not already loaded), pay records of trainers */
  const billSnaps = new Map<string, Snap>();
  for (const s of dedupe([billsByDate, billsOwing, billsOld])) billSnaps.set(s.id, s);
  const planBillIds = new Set<string>();
  for (const p of gymPlans) if (p.invoiceId) planBillIds.add(p.invoiceId);
  for (const p of ptPlans) if (p.invoiceId) planBillIds.add(p.invoiceId);
  const trainers: { id: string; name: string; staffKey: string }[] = trainerDocs.map((t) => ({
    id: t.id,
    name: str(t.data()["name"]),
    staffKey: str(t.data()["staffId"]) || t.id,
  }));
  const [planBills, salaryDocs] = await Promise.all([
    getAll(
      [...planBillIds].filter((id) => !billSnaps.has(id)).map((id) => col("invoices").doc(id)),
    ),
    getAll(
      trainers.map((t) => col("staffPrivate").doc(t.staffKey)),
      ["monthlySalary"],
    ),
  ]);
  for (const s of planBills) if (s.exists) billSnaps.set(s.id, s);
  const bills = [...billSnaps.values()].map(bill);

  /* wave 3: every member the plans, PT plans and bills point at */
  const clientIds = new Set<string>();
  for (const p of gymPlans) if (p.clientId) clientIds.add(p.clientId);
  for (const p of ptPlans) if (p.clientId) clientIds.add(p.clientId);
  for (const b of bills) if (b.clientId) clientIds.add(b.clientId);
  const clientSnaps = await getAll(
    [...clientIds].map((id) => col("clients").doc(id)),
    MEMBER_FIELDS,
  );
  const members = clientSnaps.filter((s) => s.exists).map(member);

  /* wave 4: visit days, only for members with a running gym plan or who joined lately */
  const joinedSince = plusDays(today, -31);
  const wanted = new Set<string>();
  for (const p of gymPlans)
    if (
      p.status !== "cancelled" &&
      p.startDate &&
      p.startDate <= today &&
      (p.endDate === "" || p.endDate >= today)
    )
      wanted.add(p.clientId);
  for (const m of members) if (m.joinedOn >= joinedSince) wanted.add(m.id);
  const known = new Set(members.map((m) => m.id));
  const visitSnaps = await getAll(
    [...wanted].filter((id) => known.has(id)).map((id) => col("memberVisits").doc(id)),
  );
  const visits: Record<string, ISODate[]> = {};
  for (const s of visitSnaps) {
    if (!s.exists) continue;
    const days = Object.keys(rec(s.data()?.["days"])).filter((d) => ISO.test(d));
    if (days.length) visits[s.id] = days.sort();
  }

  /* the rest */
  const salaryOf = new Map<string, number | null>();
  salaryDocs.forEach((s, i) => {
    const t = trainers[i];
    const pay = s.exists ? num((s.data() as DocumentData)["monthlySalary"]) : 0;
    if (t) salaryOf.set(t.id, pay > 0 ? pay : null);
  });
  const trainerRows: CfoTrainer[] = trainers.map((t) => ({
    id: t.id,
    name: t.name,
    monthlySalary: salaryOf.get(t.id) ?? null,
  }));

  const ptPackagePrices = ptPackageDocs
    .map((s) => s.data())
    .filter((d) => d["isActive"] !== false && num(d["price"]) > 0)
    .map((d) => num(d["price"]));

  const firstExpenseDate = iso(firstExpense[0]?.data()["date"]);
  const expenseDocs = dedupe([expensesSince, expensesSettled, expensesOpen]);

  const input: CfoInput = {
    today,
    windowStart: win.windowStart,
    firstExpenseDate,
    bills,
    gymPlans,
    ptPlans,
    payouts: payoutDocs.map(payout),
    payments: dedupe([paymentsSince, refunds]).map(payment),
    expenses: expenseDocs.map(expense),
    otherIncome: incomeDocs.map(otherIncome),
    members,
    visits,
    trainers: trainerRows,
    ptPackagePrices,
    plansMissingEndDate:
      gymPlans.filter((p) => p.endDate === "").length +
      ptPlans.filter((p) => p.endDate === "").length,
  };
  return { input, readCount };
}
