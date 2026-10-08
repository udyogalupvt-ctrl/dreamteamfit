import {
  addDoc,
  deleteDoc,
  doc,
  documentId,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  sum,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import type { CashDay, HandoverEntry } from "@/lib/cash-book";
import { db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import { derivePaymentStatus } from "@/lib/invoice-utils";
import type {
  Invoice,
  ManualIncome,
  Payment,
  PaymentMethod,
  PayoutStatus,
  TrainerPayout,
} from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const mapPayment = (id: string, d: DocumentData): Payment => ({
  id,
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  invoiceId: d["invoiceId"] ?? "",
  invoiceNumber: d["invoiceNumber"] ?? "",
  membershipId: d["membershipId"] ?? null,
  ptAssignmentId: d["ptAssignmentId"] ?? null,
  amount: Number(d["amount"] ?? 0),
  method: d["method"] ?? "Other",
  paymentDate: d["paymentDate"] ?? "",
  kind: d["kind"] ?? "initial",
  trainerShareAmount: Number(d["trainerShareAmount"] ?? 0),
  gymAmount: Number(d["gymAmount"] ?? 0),
  membershipGymAmount: Number(d["membershipGymAmount"] ?? 0),
  ptGymAmount: Number(d["ptGymAmount"] ?? 0),
  otherGymAmount: Number(d["otherGymAmount"] ?? 0),
  createdBy: d["createdBy"] ?? "",
  createdByUid: d["createdByUid"] ?? "",
  counsellorId: d["counsellorId"] ?? "",
  counsellorName: d["counsellorName"] ?? "",
  note: String(d["note"] ?? ""),
  ...(typeof d["cashDate"] === "string" && d["cashDate"] ? { cashDate: d["cashDate"] } : {}),
  ...(d["oldSoftware"] === true
    ? { oldSoftware: true, oldSoftwareBillNo: String(d["oldSoftwareBillNo"] ?? "") }
    : {}),
  edits: Array.isArray(d["edits"]) ? d["edits"] : [],
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
export const mapPayout = (id: string, d: DocumentData): TrainerPayout => ({
  id,
  trainerId: d["trainerId"] ?? "",
  trainerNameSnapshot: d["trainerNameSnapshot"] ?? "",
  clientId: d["clientId"] ?? "",
  clientNameSnapshot: d["clientNameSnapshot"] ?? "",
  ptAssignmentId: d["ptAssignmentId"] ?? "",
  ptPackageNameSnapshot: d["ptPackageNameSnapshot"] ?? "",
  invoiceId: d["invoiceId"] ?? "",
  grossAmount: Number(d["grossAmount"] ?? 0),
  trainerShareAmount: Number(d["trainerShareAmount"] ?? 0),
  gymShareAmount: Number(d["gymShareAmount"] ?? 0),
  paymentDate: d["paymentDate"] ?? "",
  status: d["status"] ?? "pending",
  paidAt: d["paidAt"] ?? null,
  ...(d["adjustment"] ? { adjustment: true, note: String(d["note"] ?? "") } : {}),
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});
export const mapManualIncome = (id: string, d: DocumentData): ManualIncome => ({
  id,
  title: d["title"] ?? "",
  category: d["category"] ?? "Other",
  amount: Number(d["amount"] ?? 0),
  method: d["method"] ?? "Cash",
  date: d["date"] ?? "",
  notes: d["notes"] ?? "",
  createdBy: d["createdBy"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribePayments = (ok: (x: Payment[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(COLLECTIONS.payments, mapPayment, ok, fail, orderBy("createdAt", "desc"));
export const subscribeClientPayments = (
  clientId: string,
  ok: (x: Payment[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.payments), where("clientId", "==", clientId)),
    mapPayment,
    (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    fail,
  );
export const subscribePayouts = (ok: (x: TrainerPayout[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.trainerPayouts,
    mapPayout,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );
/** Payments dated `from` (YYYY-MM-DD) or later, newest first: only the period a screen shows. */
export const subscribePaymentsSince = (
  from: string,
  ok: (x: Payment[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.payments), where("paymentDate", ">=", from)),
    mapPayment,
    (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    fail,
  );
export const subscribeManualIncomeSince = (
  from: string,
  ok: (x: ManualIncome[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.manualIncome), where("date", ">=", from)),
    mapManualIncome,
    ok,
    fail,
  );

/**
 * All money ever collected (same as buildFinanceSummary's gross with no dates), added up by the
 * database: about 1 read per 1,000 records instead of reading every payment and bill. Old bills
 * imported without payment records count their paid amount.
 */
export async function allTimeCollected() {
  // A sum over filtered bills needs a database index the gym's project doesn't have (it failed
  // there, leaving "Total collected" on "…"): counts and an unfiltered sum need none.
  const [payments, bills, tracked] = await Promise.all([
    getAggregateFromServer(col(COLLECTIONS.payments), { total: sum("amount") }),
    getCountFromServer(col(COLLECTIONS.invoices)),
    getCountFromServer(query(col(COLLECTIONS.invoices), where("paymentsTracked", "==", true))),
  ]);
  const paid = Number(payments.data().total ?? 0);
  const all = bills.data().count;
  const withPayments = tracked.data().count;
  // Usually every bill has its payments recorded: the payments are the whole story.
  if (all === withPayments) return round(paid);
  // Bills paid before payments were recorded (old data) count what they say was paid.
  const paidOn = (docs: { data: () => DocumentData }[]) =>
    docs.reduce(
      (n, d) => n + (d.data()["paymentsTracked"] ? 0 : Number(d.data()["amountPaid"] ?? 0)),
      0,
    );
  const old = await getDocs(
    query(col(COLLECTIONS.invoices), where("paymentsTracked", "==", false)),
  );
  if (old.size + withPayments >= all) return round(paid + paidOn(old.docs));
  // Some are older still (no such field at all): read the bills once to find them.
  return round(paid + paidOn((await getDocs(col(COLLECTIONS.invoices))).docs));
}

/**
 * Money collected in each of the last `months` months (refunds taken off), newest first. The
 * payments are read once and added up here: a database sum per month would need an index the
 * gym's project doesn't have.
 */
export async function collectedByMonth(months = 6) {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = iso(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
  const snap = await getDocs(query(col(COLLECTIONS.payments), where("paymentDate", ">=", from)));
  const byMonth = new Map<string, number>();
  snap.docs.forEach((d) => {
    const m = String(d.data()["paymentDate"] ?? "").slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(d.data()["amount"] ?? 0));
  });
  return Array.from({ length: months }, (_, i) => {
    const month = iso(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7);
    return { month, total: round(byMonth.get(month) ?? 0) };
  });
}

export const subscribeManualIncome = (ok: (x: ManualIncome[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.manualIncome,
    mapManualIncome,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );

/** First day whose cash can still change: the 1st of last month (Day Book carry-forward). */
export function cashOpenFrom(today = todayISO()) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const back = new Date(Date.UTC(y, m - 2, 1));
  return back.toISOString().slice(0, 10);
}

/** Day Book cash before the 1st of last month is carried forward: those lines stay as they are. */
function assertCashOpen(...dates: string[]) {
  const from = cashOpenFrom();
  if (dates.some((d) => d < from))
    throw new Error(
      `Cash before ${from.split("-").reverse().join("-")} is already carried forward in the Day Book: it can't change.`,
    );
}

/** Corrects an "other income" line (typo in the amount, date, mode…). */
export async function updateManualIncome(
  before: Pick<ManualIncome, "id" | "date">,
  input: Pick<ManualIncome, "title" | "category" | "amount" | "method" | "date">,
) {
  assertCashOpen(before.date, input.date);
  const id = before.id;
  await updateDoc(doc(db, COLLECTIONS.manualIncome, id), {
    ...input,
    updatedAt: serverTimestamp(),
  });
}

/** Removes an "other income" line added by mistake; returns how to put it back (Undo). */
export async function removeManualIncome(m: ManualIncome) {
  assertCashOpen(m.date);
  const ref = doc(db, COLLECTIONS.manualIncome, m.id);
  await deleteDoc(ref);
  const { id: _id, createdAt, ...rest } = m;
  return () => setDoc(ref, { ...rest, createdAt, updatedAt: serverTimestamp() });
}

export async function addManualIncome(input: Omit<ManualIncome, "id" | "createdAt" | "updatedAt">) {
  await addDoc(col(COLLECTIONS.manualIncome), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
export async function setPayoutStatus(id: string, status: PayoutStatus) {
  await updateDoc(doc(db, COLLECTIONS.trainerPayouts, id), {
    status,
    paidAt: status === "paid" ? todayISO() : null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Splits a collected amount proportionally across the invoice's composition so
 * trainer share is never counted as gym income, even for partial payments.
 *
 * A discount (with `subtotal` and `discount` given) lowers the membership and PT parts by the same
 * share, so a ₹2,499 plan sold for ₹1,999 counts ₹1,999 as membership income, not ₹2,499. The
 * trainer's share stays as agreed (it was worked out on the PT price).
 */
export function allocatePayment(
  invoice: Pick<Invoice, "total" | "membershipGross" | "ptGross" | "trainerShareTotal"> &
    Partial<Pick<Invoice, "subtotal" | "discount">>,
  amount: number,
) {
  const ratio = invoice.total > 0 ? amount / invoice.total : 0;
  const subtotal = Number(invoice.subtotal ?? 0);
  const discount = Number(invoice.discount ?? 0);
  const keep = subtotal > 0 && discount > 0 ? Math.max(0, subtotal - discount) / subtotal : 1;
  const trainerShareAmount = round(invoice.trainerShareTotal * ratio);
  const membershipGymAmount = round(invoice.membershipGross * keep * ratio);
  const ptGymAmount = round((invoice.ptGross * keep - invoice.trainerShareTotal) * ratio);
  const gymAmount = round(amount - trainerShareAmount);
  return {
    trainerShareAmount,
    gymAmount,
    membershipGymAmount,
    ptGymAmount,
    otherGymAmount: round(Math.max(0, gymAmount - membershipGymAmount - ptGymAmount)),
  };
}

/** Records a payment against an existing balance only. Never re-records the original payment. */
/**
 * Collects (part of) a balance. `nextPaymentDate` = when the rest will be paid, required while a
 * balance remains; the WhatsApp payment reminder goes out that morning.
 */
export async function recordBalancePayment(
  invoice: Invoice,
  amount: number,
  method: PaymentMethod,
  staffName: string,
  opts: { staffUid?: string; nextPaymentDate?: string | null } = {},
) {
  const ref = doc(db, COLLECTIONS.invoices, invoice.id);
  const payRef = doc(col(COLLECTIONS.payments));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Invoice not found.");
    const d = snap.data();
    const total = Number(d["total"] ?? 0),
      paid = Number(d["amountPaid"] ?? 0),
      balance = round(total - paid);
    if (amount <= 0) throw new Error("Enter an amount greater than zero.");
    if (amount > balance) throw new Error(`Amount cannot exceed the remaining balance.`);
    const newPaid = round(paid + amount),
      newBalance = round(total - newPaid),
      status = derivePaymentStatus(total, newPaid);
    if (newBalance > 0 && !opts.nextPaymentDate)
      throw new Error("Pick the date the member will pay the rest.");
    const alloc = allocatePayment(
      {
        total,
        membershipGross: Number(d["membershipGross"] ?? 0),
        ptGross: Number(d["ptGross"] ?? 0),
        trainerShareTotal: Number(d["trainerShareTotal"] ?? 0),
        subtotal: Number(d["subtotal"] ?? 0),
        discount: Number(d["discount"] ?? 0),
      },
      amount,
    );
    tx.set(payRef, {
      clientId: d["clientId"],
      clientNameSnapshot: d["clientNameSnapshot"],
      invoiceId: invoice.id,
      invoiceNumber: d["invoiceNumber"],
      membershipId: d["membershipId"] ?? null,
      ptAssignmentId: d["ptAssignmentId"] ?? null,
      amount,
      method,
      paymentDate: todayISO(),
      kind: "balance",
      ...alloc,
      createdBy: staffName,
      createdByUid: opts.staffUid ?? "",
      counsellorId: d["counsellorId"] ?? "",
      counsellorName: d["counsellorName"] ?? "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const patch = {
      amountPaid: newPaid,
      balanceDue: newBalance,
      paymentStatus: status,
      ...(newBalance > 0 && opts.nextPaymentDate ? { dueDate: opts.nextPaymentDate } : {}),
      updatedAt: serverTimestamp(),
    };
    tx.update(ref, { ...patch, paymentsTracked: true });
    if (d["publicToken"]) tx.update(doc(db, COLLECTIONS.publicInvoices, d["publicToken"]), patch);
  });
  return { paymentId: payRef.id };
}

/**
 * Takes back a balance payment entered by mistake: the payment is removed and its bill shows the
 * amount as due again (Undo right after saving, or "Undo" on the day's payment).
 */
export async function undoBalancePayment(paymentId: string) {
  const payRef = doc(db, COLLECTIONS.payments, paymentId);
  await runTransaction(db, async (tx) => {
    const pay = await tx.get(payRef);
    if (!pay.exists()) throw new Error("That payment was already removed.");
    const p = pay.data();
    if (p["kind"] !== "balance" || p["oldSoftware"] === true || !p["invoiceId"])
      throw new Error("Only a balance payment can be undone here.");
    const invRef = doc(db, COLLECTIONS.invoices, String(p["invoiceId"]));
    const inv = await tx.get(invRef);
    if (!inv.exists()) throw new Error("Its bill was not found.");
    const d = inv.data();
    const total = Number(d["total"] ?? 0);
    const paid = round(Math.max(0, Number(d["amountPaid"] ?? 0) - Number(p["amount"] ?? 0)));
    const patch = {
      amountPaid: paid,
      balanceDue: round(total - paid),
      paymentStatus: derivePaymentStatus(total, paid),
      ...(d["dueDate"] ? {} : { dueDate: todayISO() }),
      updatedAt: serverTimestamp(),
    };
    tx.update(invRef, patch);
    if (d["publicToken"]) tx.update(doc(db, COLLECTIONS.publicInvoices, d["publicToken"]), patch);
    tx.delete(payRef);
  });
}

export interface FinanceSummary {
  gross: number;
  membershipIncome: number;
  ptGross: number;
  ptGymIncome: number;
  trainerPayable: number;
  otherIncome: number;
  manualIncome: number;
  gymIncome: number;
  expenses: number;
  net: number;
  /** Money given back (refunds): already taken off gross. */
  refunded: number;
}

/** Single source of truth: payments (+ legacy invoices without payment records) and labelled manual income. */
export function buildFinanceSummary(
  payments: Payment[],
  invoices: Invoice[],
  manual: ManualIncome[],
  expenses: { amount: number; date: string }[],
  from?: string,
  to?: string,
): FinanceSummary {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const ps = payments.filter((p) => inRange(p.paymentDate));
  const legacy = invoices.filter(
    (i) => !i.paymentsTracked && i.amountPaid > 0 && inRange(i.invoiceDate),
  );
  const legacyAmt = legacy.reduce((n, i) => n + i.amountPaid, 0);
  const sum = (f: (p: Payment) => number) => round(ps.reduce((n, p) => n + f(p), 0));
  const trainerPayable = sum((p) => p.trainerShareAmount);
  const ptGymIncome = sum((p) => p.ptGymAmount);
  const membershipIncome = round(sum((p) => p.membershipGymAmount) + legacyAmt);
  const otherIncome = sum((p) => p.otherGymAmount);
  const manualIncome = round(
    manual.filter((m) => inRange(m.date)).reduce((n, m) => n + m.amount, 0),
  );
  const gross = round(sum((p) => p.amount) + legacyAmt);
  const gymIncome = round(gross - trainerPayable + manualIncome);
  const exp = round(expenses.filter((e) => inRange(e.date)).reduce((n, e) => n + e.amount, 0));
  return {
    gross,
    membershipIncome,
    ptGross: round(ptGymIncome + trainerPayable),
    ptGymIncome,
    trainerPayable,
    otherIncome,
    manualIncome,
    gymIncome,
    expenses: exp,
    net: round(gymIncome - exp),
    refunded: round(-ps.reduce((n, p) => n + Math.min(0, p.amount), 0)),
  };
}

// ------------------------------------------------------------------ daily cash book

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * A day's handovers. Days saved before handovers were a list hold one total: it reads as one
 * handover given that day.
 */
function handoversOf(date: string, d: DocumentData): HandoverEntry[] {
  if (Array.isArray(d["handovers"]))
    return (d["handovers"] as DocumentData[]).map((h, i) => ({
      id: String(h["id"] ?? i),
      amount: Number(h["amount"] ?? 0),
      to: String(h["to"] ?? ""),
      note: String(h["note"] ?? ""),
      givenOn: String(h["givenOn"] ?? date),
      at: Number(h["at"] ?? 0),
      by: String(h["by"] ?? ""),
    }));
  const amount = Number(d["handover"] ?? 0);
  return amount > 0
    ? [
        {
          id: "legacy",
          amount,
          to: String(d["handoverTo"] ?? ""),
          note: String(d["note"] ?? ""),
          givenOn: date,
          at: 0,
          by: String(d["updatedBy"] ?? ""),
        },
      ]
    : [];
}

const mapCashDay = (d: { id: string; data: () => DocumentData }): CashDay => {
  const handovers = handoversOf(d.id, d.data());
  return {
    date: d.id,
    handover: round(handovers.reduce((n, h) => n + h.amount, 0)),
    handoverTo: String(d.data()["handoverTo"] ?? ""),
    note: String(d.data()["note"] ?? ""),
    handovers,
    openingOverride: num(d.data()["openingOverride"]),
    carriedOpening: num(d.data()["carriedOpening"]),
  };
};

export const subscribeCashDays = (ok: (x: CashDay[]) => void, fail: (e: Error) => void) =>
  onSnapshot(col(COLLECTIONS.cashDays), (s) => ok(s.docs.map(mapCashDay)), fail);

/** Cash days from `from` (YYYY-MM-DD) on; all of them when `from` is "". */
export const subscribeCashDaysSince = (
  from: string,
  ok: (x: CashDay[]) => void,
  fail: (e: Error) => void,
) =>
  onSnapshot(
    from
      ? query(col(COLLECTIONS.cashDays), where(documentId(), ">=", from))
      : col(COLLECTIONS.cashDays),
    (s) => ok(s.docs.map(mapCashDay)),
    fail,
  );

/** Days with a saved carry-forward (about one a month), oldest first. */
export async function cashCheckpoints() {
  const snap = await getDocs(query(col(COLLECTIONS.cashDays), where("carriedOpening", ">", -1e12)));
  return snap.docs.map((d) => d.id).sort();
}

/** Saves a day's worked-out opening cash as a carry-forward point (never over a typed opening). */
export async function saveCashCheckpoint(date: string, opening: number) {
  await setDoc(
    doc(db, COLLECTIONS.cashDays, date),
    { carriedOpening: round(opening), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** The total and the "given to" names kept beside the list (read by exports and older screens). */
const handoverFields = (list: HandoverEntry[]) => ({
  handovers: list,
  handover: round(list.reduce((n, h) => n + h.amount, 0)),
  handoverTo: [...new Set(list.map((h) => h.to).filter(Boolean))].join(", "),
  note: list
    .map((h) => h.note)
    .filter(Boolean)
    .join(" · "),
});

/**
 * Records cash handed over out of one day's cash (`date`), e.g. yesterday's cash handed to the
 * owner this morning: it is booked on yesterday, so yesterday's closing and today's opening go
 * down, and it remembers it was given today. A day can have several handovers.
 */
export async function addHandover(
  date: string,
  input: { amount: number; to: string; note: string },
  by: string,
) {
  const amount = round(Number(input.amount));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick the day of the cash.");
  if (date > todayISO()) throw new Error("The cash of a future day can't be handed over yet.");
  if (!(amount > 0)) throw new Error("Enter the amount handed over.");
  const entry: HandoverEntry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    amount,
    to: input.to.trim(),
    note: input.note.trim(),
    givenOn: todayISO(),
    at: Date.now(),
    by,
  };
  await putHandover(date, entry, by);
  return entry;
}

/** Saves one handover entry on a day as it is (also Undo after a removal). */
export async function putHandover(date: string, entry: HandoverEntry, by: string) {
  const ref = doc(db, COLLECTIONS.cashDays, date);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const list = [...handoversOf(date, snap.data() ?? {}).filter((h) => h.id !== entry.id), entry];
    tx.set(
      ref,
      { ...handoverFields(list), updatedBy: by, updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}

/** Takes back one handover entered by mistake. */
export async function removeHandover(date: string, id: string, by: string) {
  const ref = doc(db, COLLECTIONS.cashDays, date);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const list = handoversOf(date, snap.data() ?? {}).filter((h) => h.id !== id);
    tx.set(
      ref,
      { ...handoverFields(list), updatedBy: by, updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}

/** Cash in the drawer at the start of a day, typed by hand (null = follow the day before). */
export async function saveOpeningCash(date: string, opening: number | null, by: string) {
  await setDoc(
    doc(db, COLLECTIONS.cashDays, date),
    {
      openingOverride: opening === null ? null : Math.max(0, round(opening)),
      updatedBy: by,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
