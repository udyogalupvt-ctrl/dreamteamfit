/**
 * One month tab of the backup sheet: ONE ROW PER PAYMENT on the day it was paid, exactly the
 * dashboard's rule (finance.service buildFinanceSummary): money counts on its paymentDate, and an
 * old bill with no payment records counts on its invoiceDate. The totals are computed twice
 * (from the payments, and from the rows) so the sheet can say "matches" or "DIFFERENT".
 *
 * Pure (no database): the server reads Firestore and hands plain shapes in.
 */
import { planMoney } from "../plan-money.ts";
import type { BillIn, ClientIn, Column, PackageIn, PayIn, PlanIn, PtIn } from "./types.ts";

/** "Strength + Cardio" is how the package is stored; the gym says "Cardio & strengthening". */
export const CATEGORY_LABEL: Record<string, string> = {
  "Strength + Cardio": "Cardio & strengthening",
  "Strength Only": "Strengthening",
  "Cardio Only": "Cardio",
};

/** 2026-10-13 → 13-10-2026 (empty stays empty). */
export const dmy = (iso: string | undefined | null): string =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "";

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface MonthInput {
  /** First and last day counted (YYYY-MM-DD); the last is never after today. */
  from: string;
  to: string;
  /** Payments whose paymentDate is in the month. */
  payments: PayIn[];
  /** Bills dated in the month with paymentsTracked === false and amountPaid > 0. */
  legacyBills: BillIn[];
  /**
   * Bills dated in the month (total > 0) that have no "initial" payment: sold with ₹0 paid that day.
   * Each gets its own sale row (paid ₹0) so its total bill, fees and discount are counted; the
   * later payments stay Balance rows.
   */
  unpaidSales?: BillIn[];
  /** Every bill the payments / legacy bills point to, by id. */
  bills: Map<string, BillIn>;
  plans: Map<string, PlanIn>;
  pts: Map<string, PtIn>;
  clients: Map<string, ClientIn>;
  packages: Map<string, PackageIn>;
  /** Every gym plan of the members in this month (to tell Renewal from New). */
  plansOfClients: PlanIn[];
}

export interface MonthRow {
  /** Day paid (ISO). */
  date: string;
  /** IST day it was typed in (ISO). */
  entered: string;
  billNo: string;
  /** Groups rows of one bill so its due is counted once. */
  billKey: string;
  /** Member ID (clientCode). */
  id: string;
  name: string;
  kind: string;
  type: string;
  phone: string;
  start: string;
  end: string;
  pkg: string;
  days: number | "";
  pp: number;
  cash: number;
  card: number;
  other: number;
  old: number;
  paid: number;
  due: number;
  gymFee: number | "";
  totalBill: number | "";
  discount: number | "";
  counsellor: string;
  ptFee: number | "";
  trainer: string;
  ptEnd: string;
  payBy: string;
  status: string;
  note: string;
}

export const MONTH_COLUMNS: Column<MonthRow>[] = [
  { header: "S.NO", value: (_r, i) => i + 1, width: 48, kind: "number" },
  { header: "DATE PAID", value: (r) => r.date, width: 96, kind: "date" },
  { header: "NAME", value: (r) => r.name, width: 170, kind: "text" },
  { header: "PHONE NO", value: (r) => r.phone, width: 110, kind: "text" },
  { header: "PAYMENT FOR", value: (r) => r.kind, width: 130, kind: "text" },
  { header: "PACKAGE", value: (r) => r.pkg, width: 210, kind: "text" },
  { header: "PP", value: (r) => r.pp, width: 96, kind: "money", money: "sum", color: "#6A1B9A" },
  {
    header: "CASH",
    value: (r) => r.cash,
    width: 96,
    kind: "money",
    money: "sum",
    color: "#0D47A1",
  },
  {
    header: "CARD",
    value: (r) => r.card,
    width: 96,
    kind: "money",
    money: "sum",
    color: "#1B5E20",
  },
  { header: "OTHER", value: (r) => r.other, width: 96, kind: "money", money: "sum" },
  { header: "PAID IN OLD SOFTWARE", value: (r) => r.old, width: 110, kind: "money", money: "sum" },
  { header: "PAID AMOUNT", value: (r) => r.paid, width: 104, kind: "money", money: "sum" },
  {
    header: "DUE NOW",
    value: (r) => r.due,
    width: 96,
    kind: "money",
    money: "due",
    color: "#B71C1C",
  },
  { header: "TOTAL BILL", value: (r) => r.totalBill, width: 100, kind: "money", money: "sum" },
  { header: "GYM FEE", value: (r) => r.gymFee, width: 96, kind: "money", money: "sum" },
  { header: "PT FEE", value: (r) => r.ptFee, width: 96, kind: "money", money: "sum" },
  { header: "DISCOUNT", value: (r) => r.discount, width: 96, kind: "money", money: "sum" },
  { header: "Counseller", value: (r) => r.counsellor, width: 120, kind: "text" },
  { header: "PT Trainer", value: (r) => r.trainer, width: 120, kind: "text" },
  { header: "TYPE OF CLIENT", value: (r) => r.type, width: 160, kind: "text" },
  { header: "START DATE", value: (r) => r.start, width: 96, kind: "date" },
  { header: "ENDING DATE", value: (r) => r.end, width: 96, kind: "date" },
  { header: "DAYS", value: (r) => r.days, width: 60, kind: "number" },
  { header: "PT End date", value: (r) => r.ptEnd, width: 96, kind: "date" },
  { header: "Membership payment due date", value: (r) => r.payBy, width: 120, kind: "date" },
  { header: "STATUS", value: (r) => r.status, width: 100, kind: "text" },
  { header: "NOTE", value: (r) => r.note, width: 240, kind: "text" },
  { header: "ENTERED ON", value: (r) => r.entered, width: 96, kind: "date" },
  { header: "BILL NO", value: (r) => r.billNo, width: 100, kind: "text" },
  { header: "MEMBER ID", value: (r) => r.id, width: 100, kind: "text" },
];

export function buildMonth(input: MonthInput): {
  rows: MonthRow[];
  appTotal: number;
  sheetTotal: number;
  dueOnBills: number;
  matches: boolean;
} {
  const { from, to } = input;
  // Only days inside the month and up to today count, like the dashboard.
  const pays = input.payments.filter((p) => p.paymentDate >= from && p.paymentDate <= to);
  const legacy = input.legacyBills.filter((b) => b.invoiceDate >= from && b.invoiceDate <= to);

  const saleKind = (
    clientId: string,
    plan: PlanIn | undefined,
    pt: PtIn | undefined,
    b: BillIn | undefined,
  ) => {
    if (b && (b.items[0]?.name ?? "").startsWith("Balance from the old software"))
      return "Old software balance";
    if ((b?.upgradeCredit ?? 0) > 0) return "Upgrade";
    if (!plan) return pt ? "PT" : "Other";
    return input.plansOfClients.some(
      (m) => m.clientId === clientId && m.id !== plan.id && m.startDate < plan.startDate,
    )
      ? "Renewal"
      : "New";
  };

  // A split payment (Cash + UPI) is two payment docs with one splitId: one row.
  const groups = new Map<string, PayIn[]>();
  for (const p of pays) {
    const k = p.splitId ? `split:${p.splitId}` : p.id;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  // A sale with ₹0 paid that day has no payment doc: a ₹0 stand-in gives it its sale row.
  // It is not in `pays`, so the money totals (the dashboard's) don't change.
  const zeroPaid = new Set<PayIn>();
  const bills = new Map(input.bills);
  for (const b of input.unpaidSales ?? []) {
    if (b.invoiceDate < from || b.invoiceDate > to || !(b.total > 0)) continue;
    const p: PayIn = {
      id: `sale:${b.id}`,
      clientId: b.clientId,
      clientNameSnapshot: b.clientNameSnapshot,
      invoiceId: b.id,
      membershipId: b.membershipId,
      ptAssignmentId: b.ptAssignmentId,
      amount: 0,
      method: "",
      paymentDate: b.invoiceDate,
      kind: "initial",
      counsellorName: b.counsellorName,
      createdDay: b.createdDay,
    };
    zeroPaid.add(p);
    bills.set(b.id, b);
    groups.set(p.id, [p]);
  }

  const rows: MonthRow[] = [];
  for (const ps of groups.values()) {
    const p = ps[0]!;
    const b = bills.get(p.invoiceId);
    const plan = input.plans.get(p.membershipId ?? b?.membershipId ?? "");
    const pt = input.pts.get(p.ptAssignmentId ?? b?.ptAssignmentId ?? "");
    const c = input.clients.get(p.clientId);
    const m = { pp: 0, cash: 0, card: 0, other: 0, old: 0 };
    for (const x of ps) {
      if (x.oldSoftware || x.method === "Not recorded") m.old += x.amount;
      else if (x.method === "UPI") m.pp += x.amount;
      else if (x.method === "Cash") m.cash += x.amount;
      else if (x.method === "Card") m.card += x.amount;
      else m.other += x.amount;
    }
    const amount = round(ps.reduce((s, x) => s + x.amount, 0));
    // The sale row carries the fees; balance rows don't, so the columns add up without doubling.
    // An old-software balance (no bill) is a Balance row: the first old-software row has the bill.
    const sale = p.kind === "initial" || (!!p.oldSoftware && !b && p.kind !== "balance");
    const kind =
      p.kind === "refund"
        ? "Refund"
        : p.kind === "balance"
          ? "Balance"
          : p.oldSoftware && !b
            ? "Old software"
            : saleKind(p.clientId, plan, pt, b);
    // A member deleted with "bills & payments kept" has no plan / PT doc: the bill has the split.
    const gone = !!b && ((!!b.membershipId && !plan) || (!!b.ptAssignmentId && !pt));
    const gym =
      sale && b && (plan || (b.membershipId && b.membershipGross > 0))
        ? planMoney("gym", plan?.priceSnapshot ?? b.membershipGross, b)
        : null;
    const ptm =
      sale && b && (pt || (b.ptAssignmentId && b.ptGross > 0))
        ? planMoney("pt", pt?.ptPrice ?? b.ptGross, b)
        : null;
    const due = b ? Math.max(0, b.balanceDue) : p.oldSoftware ? plan?.oldSoftwareBalance || 0 : 0;
    // No bill (sold in the old software): the plan keeps all it was paid there, over every part.
    const oldBill = round(
      Math.max(amount, (plan ? plan.oldSoftwarePaid : pt?.oldSoftwarePaid) ?? 0) + due,
    );
    const cancelled = plan?.status === "cancelled" || pt?.status === "cancelled";
    const pkg = plan ? input.packages.get(plan.packageId) : undefined;
    const notes: string[] = [];
    if (zeroPaid.has(p)) notes.push("nothing paid on the sale day");
    else if (p.paymentDate < p.createdDay) notes.push("entered later, dated the day it was paid");
    if (gone) notes.push("member or plan deleted, bill kept");
    if (p.kind === "balance" && amount > 0 && amount <= 10)
      notes.push(`₹${amount} top-up after price change`);
    rows.push({
      date: p.paymentDate,
      entered: p.createdDay,
      billNo:
        b?.invoiceNumber ?? (p.oldSoftwareBillNo ? `Old ${p.oldSoftwareBillNo}` : "Old software"),
      billKey: b?.id ?? `old:${p.membershipId ?? p.ptAssignmentId}`,
      id: c?.clientCode ?? "",
      name: c?.fullName ?? p.clientNameSnapshot,
      kind,
      type: plan
        ? (CATEGORY_LABEL[pkg?.category ?? ""] ?? pkg?.category ?? "")
        : pt
          ? "Personal training"
          : "",
      phone: c?.phone ?? b?.clientPhoneSnapshot ?? "",
      start: plan?.startDate ?? pt?.startDate ?? "",
      end: plan?.endDate ?? pt?.endDate ?? "",
      pkg: plan?.packageNameSnapshot ?? pt?.ptPackageNameSnapshot ?? b?.items[0]?.name ?? "",
      days: plan?.durationDaysSnapshot ?? "",
      pp: m.pp,
      cash: m.cash,
      card: m.card,
      other: m.other,
      old: m.old,
      paid: amount,
      due,
      gymFee: gym ? gym.total : sale && !b && plan ? oldBill : "",
      totalBill: sale ? (b ? b.total : oldBill) : "",
      discount:
        sale && b
          ? Math.max(0, (b.discount || 0) - (b.upgradeCredit || 0) - (b.oldSoftwareCredit || 0))
          : "",
      counsellor: p.counsellorName || b?.counsellorName || plan?.counsellorName || "",
      ptFee: ptm ? ptm.total : sale && !b && pt && !plan ? oldBill : "",
      trainer: pt?.trainerNameSnapshot ?? "",
      ptEnd: pt?.endDate ?? "",
      payBy: due > 0 && b ? b.dueDate : "",
      status: cancelled
        ? "Cancelled"
        : p.kind === "refund"
          ? "Refunded"
          : due > 0
            ? b && b.amountPaid <= 0
              ? "Not paid"
              : "Part paid"
            : "Paid",
      note: notes.join(" · "),
    });
  }

  for (const b of legacy) {
    const plan = input.plans.get(b.membershipId ?? "");
    const c = input.clients.get(b.clientId);
    const known = ["UPI", "Cash", "Card"].includes(b.paymentMethod);
    rows.push({
      date: b.invoiceDate,
      entered: b.createdDay,
      billNo: b.invoiceNumber,
      billKey: b.id,
      id: c?.clientCode ?? "",
      name: c?.fullName ?? b.clientNameSnapshot,
      kind: "Bill (no payment record)",
      type: "",
      phone: c?.phone ?? b?.clientPhoneSnapshot ?? "",
      start: plan?.startDate ?? "",
      end: plan?.endDate ?? "",
      pkg: plan?.packageNameSnapshot ?? "",
      days: "",
      pp: b.paymentMethod === "UPI" ? b.amountPaid : 0,
      cash: b.paymentMethod === "Cash" ? b.amountPaid : 0,
      card: b.paymentMethod === "Card" ? b.amountPaid : 0,
      other: known ? 0 : b.amountPaid,
      old: 0,
      paid: b.amountPaid,
      due: b.balanceDue,
      gymFee: "",
      totalBill: b.total,
      discount: b.discount,
      counsellor: b.counsellorName,
      ptFee: "",
      trainer: "",
      ptEnd: "",
      payBy: "",
      status: b.balanceDue > 0 ? "Part paid" : "Paid",
      note: "",
    });
  }

  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.billNo).localeCompare(String(b.billNo), undefined, { numeric: true }),
  );

  // The dashboard's own formula: payments by paid date + old bills without payment records.
  const appTotal = round(
    pays.reduce((s, p) => s + p.amount, 0) + legacy.reduce((s, b) => s + b.amountPaid, 0),
  );
  const sheetTotal = round(rows.reduce((s, r) => s + r.paid, 0));
  const seen = new Set<string>();
  const dueOnBills = round(
    rows.reduce((s, r) => {
      if (seen.has(r.billKey)) return s;
      seen.add(r.billKey);
      return s + (r.due || 0);
    }, 0),
  );
  return {
    rows,
    appTotal,
    sheetTotal,
    dueOnBills,
    matches: Math.abs(appTotal - sheetTotal) < 0.01,
  };
}
