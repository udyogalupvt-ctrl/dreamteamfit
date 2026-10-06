/**
 * Small builders for the CFO tests (test support only; nothing in the app imports this).
 * Every builder fills the boring fields so a test only states what it is about.
 */
import type {
  CfoBill,
  CfoExpense,
  CfoGymPlan,
  CfoInput,
  CfoMember,
  CfoOtherIncome,
  CfoPayment,
  CfoPayout,
  CfoPtPlan,
  CfoTrainer,
} from "./types.ts";

export const TODAY = "2026-10-06";

export function bill(o: Partial<CfoBill> & { id: string }): CfoBill {
  const subtotal = o.subtotal ?? 0;
  const discount = o.discount ?? 0;
  const tax = o.tax ?? 0;
  const total = o.total ?? subtotal - discount + tax;
  const amountPaid = o.amountPaid ?? total;
  return {
    number: `B-${o.id}`,
    clientId: "c1",
    clientName: "Test Member",
    clientPhone: "9000000000",
    invoiceDate: "2026-09-01",
    dueDate: "",
    subtotal,
    discount,
    tax,
    total,
    amountPaid,
    balanceDue: Math.max(0, total - amountPaid),
    closedAmount: 0,
    status: amountPaid >= total ? "paid" : "partial",
    membershipId: null,
    ptAssignmentId: null,
    membershipGross: 0,
    ptGross: 0,
    upgradeCredit: 0,
    paymentsTracked: true,
    itemNames: ["Plan"],
    ...o,
  };
}

export function gym(o: Partial<CfoGymPlan> & { id: string }): CfoGymPlan {
  return {
    clientId: "c1",
    packageName: "Monthly",
    listPrice: 1200,
    startDate: "2026-09-01",
    endDate: "2026-09-12",
    originalEndDate: null,
    upgradeCredit: 0,
    status: "active",
    cancelledOn: null,
    cancelId: null,
    invoiceId: `b-${o.id}`,
    pauses: [],
    paidInOldSoftware: false,
    imported: false,
    upgradedTo: null,
    upgradeFrom: null,
    createdOn: "2026-09-01",
    ...o,
  };
}

export function pt(o: Partial<CfoPtPlan> & { id: string }): CfoPtPlan {
  return {
    clientId: "c1",
    trainerId: "t1",
    trainerName: "Coach",
    packageName: "PT 10",
    listPrice: 1000,
    trainerShareAmount: 0,
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    status: "active",
    cancelledOn: null,
    cancelId: null,
    invoiceId: `b-${o.id}`,
    paidInOldSoftware: false,
    createdOn: "2026-09-01",
    ...o,
  };
}

export function payout(o: Partial<CfoPayout> & { id: string; ptAssignmentId: string }): CfoPayout {
  const share = o.trainerShareAmount ?? 0;
  return {
    trainerId: "t1",
    trainerShareAmount: share,
    originalShare: share,
    status: "pending",
    paidAt: null,
    adjustment: false,
    date: "2026-09-01",
    ...o,
  };
}

export function payment(o: Partial<CfoPayment> & { id: string; amount: number }): CfoPayment {
  return {
    paymentDate: "2026-09-01",
    kind: o.amount < 0 ? "refund" : "initial",
    cancelId: null,
    invoiceId: "",
    ...o,
  };
}

export function expense(o: Partial<CfoExpense> & { id: string; amount: number }): CfoExpense {
  return {
    date: "2026-09-02",
    category: "Rent",
    paidByGym: true,
    settled: true,
    settledDate: null,
    ...o,
  };
}

export function income(
  o: Partial<CfoOtherIncome> & { id: string; amount: number },
): CfoOtherIncome {
  return { date: "2026-09-03", category: "Sale", ...o };
}

export function member(o: Partial<CfoMember> & { id: string }): CfoMember {
  return {
    name: `Member ${o.id}`,
    phone: "9000000000",
    code: o.id.replace(/\D/g, "") || "1",
    joinedOn: "2026-01-01",
    lastVisitDate: "",
    thumbSince: "",
    tracked: true,
    ...o,
  };
}

export function trainer(o: Partial<CfoTrainer> & { id: string }): CfoTrainer {
  return { name: `Trainer ${o.id}`, monthlySalary: null, ...o };
}

export function input(o: Partial<CfoInput> = {}): CfoInput {
  return {
    today: TODAY,
    windowStart: "2026-04-01",
    firstExpenseDate: "",
    bills: [],
    gymPlans: [],
    ptPlans: [],
    payouts: [],
    payments: [],
    expenses: [],
    otherIncome: [],
    members: [],
    visits: {},
    trainers: [],
    ptPackagePrices: [],
    plansMissingEndDate: 0,
    ...o,
  };
}

/** A gym plan and its bill (list price = billed = paid unless told otherwise). */
export function gymBilled(
  id: string,
  clientId: string,
  start: string,
  end: string,
  price: number,
  o: { paid?: number; plan?: Partial<CfoGymPlan>; bill?: Partial<CfoBill> } = {},
): { plan: CfoGymPlan; bill: CfoBill } {
  const plan = gym({
    id,
    clientId,
    startDate: start,
    endDate: end,
    listPrice: price,
    invoiceId: `b-${id}`,
    ...o.plan,
  });
  const b = bill({
    id: `b-${id}`,
    clientId,
    subtotal: price,
    membershipId: id,
    membershipGross: price,
    invoiceDate: start,
    amountPaid: o.paid ?? price,
    ...o.bill,
  });
  return { plan, bill: b };
}

/** Put several gymBilled() results into an input. */
export function withPlans(
  base: CfoInput,
  ...plans: { plan: CfoGymPlan; bill: CfoBill }[]
): CfoInput {
  return {
    ...base,
    gymPlans: [...base.gymPlans, ...plans.map((p) => p.plan)],
    bills: [...base.bills, ...plans.map((p) => p.bill)],
  };
}

/** Every number found anywhere inside a value (for the "no NaN / Infinity" checks). */
export function allNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) for (const x of v) allNumbers(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) allNumbers(x, out);
  return out;
}
