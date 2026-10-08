/**
 * CFO contracts shared by the server (src/server/cfo*.ts), the pure maths (src/lib/cfo/*) and the
 * page (src/routes/_authenticated/cfo.tsx). Plain JSON-friendly shapes only: no Firestore types,
 * no `undefined` (Firestore rejects it), dates as "YYYY-MM-DD" strings in IST.
 * See CFO_PLAN.md for the exact maths behind every field.
 *
 * Functions the pure module exports (src/lib/cfo/index.ts):
 *   reportWindow(today)                                   → CfoWindow
 *   computeCfo(input, settings, meta)                     → CfoComputed
 *   buildBriefInput(snapshot, settings)                   → CfoBriefInput
 *   briefSystemPrompt(language)                           → string
 *   briefPrivacyCheck(json, names)                        → { ok: true } | { ok: false; reason: string }
 *   verifyBriefNumbers(text, input)                       → { ok: boolean; unknown: string[] }
 */

export type ISODate = string;

/* --------------------------------------------------------------- collections */

export const CFO_COLLECTIONS = {
  settings: "cfoSettings",
  reports: "cfoReports",
  briefs: "cfoBriefs",
} as const;

export const CFO_SETTINGS_DOC = "main";
export const CFO_REPORT_DOC = "latest";
export const CFO_BRIEF_LATEST_DOC = "latest";
export const CFO_BRIEF_STATUS_DOC = "status";

export const CFO_LIST_KEYS = ["atRisk", "renewals", "newSlipping", "ptChances", "dues"] as const;
export type CfoListKey = (typeof CFO_LIST_KEYS)[number];
/** Doc id of a full list in `cfoReports`: "list-atRisk", … */
export const cfoListDocId = (key: CfoListKey) => `list-${key}`;

/** Recompute at most this often (seconds), for everyone together. */
export const CFO_MIN_REFRESH_SECONDS = 600;
/** "New AI summary" presses allowed per day. */
export const CFO_MAX_MANUAL_BRIEFS_PER_DAY = 3;
/** Rows of each list kept inside `cfoReports/latest`; the rest are in the list docs. */
export const CFO_SUMMARY_ROWS = 20;
/** Most rows stored in one list doc (also trimmed to stay under ~800 KB). */
export const CFO_LIST_ROW_CAP = 1000;

/* ------------------------------------------------------------------ settings */

export const CFO_LANGUAGES = ["English", "Telugu", "Hindi"] as const;
export type CfoLanguage = (typeof CFO_LANGUAGES)[number];

/** `cfoSettings/main`. Thresholds are the spec's Layer 2 defaults. */
export interface CfoSettings {
  /** All gym money (cash + bank + UPI) at the START of `openingDate`; null = not set yet. */
  openingBalance: number | null;
  openingDate: ISODate | "";
  atRiskDays: number;
  renewalDays: number;
  newMemberMinVisits: number;
  ptMinVisits: number;
  runwayWarnMonths: number;
  graceDays: number;
  aiEnabled: boolean;
  language: CfoLanguage;
}

export const DEFAULT_CFO_SETTINGS: CfoSettings = {
  openingBalance: null,
  openingDate: "",
  atRiskDays: 14,
  renewalDays: 30,
  newMemberMinVisits: 4,
  ptMinVisits: 12,
  runwayWarnMonths: 2,
  graceDays: 15,
  // Off until the owner presses "Start AI summary" (shown once an AI is connected).
  aiEnabled: false,
  language: "English",
};

/* ------------------------------------------------------- input (normalised data) */

export type CfoBillStatus = "paid" | "partial" | "pending" | "refunded" | "closed";

export interface CfoBill {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  invoiceDate: ISODate;
  /** Pay-by date, "" when none. */
  dueDate: ISODate | "";
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  /** Balance written off when a plan was cancelled (0 when none). */
  closedAmount: number;
  status: CfoBillStatus;
  membershipId: string | null;
  ptAssignmentId: string | null;
  /** List-price gross of the gym plan on this bill; 0 when unknown. */
  membershipGross: number;
  /** List-price gross of the PT plan on this bill; 0 when unknown. */
  ptGross: number;
  /** Part of `discount` that is credit for an upgraded plan's unused days. */
  upgradeCredit: number;
  /** false = old bill without payment records (its amountPaid is the cash). */
  paymentsTracked: boolean;
  /** Item names, for the dues list ("Monthly", "PT: 12 sessions"). */
  itemNames: string[];
}

export interface CfoPause {
  on: ISODate;
  days: number;
}

export type CfoGymPlanStatus = "active" | "expired" | "cancelled" | "pending" | "biometric_pending";

export interface CfoGymPlan {
  id: string;
  clientId: string;
  packageName: string;
  /** `priceSnapshot`: list price before discount. */
  listPrice: number;
  startDate: ISODate;
  endDate: ISODate | "";
  /** Set on a plan cut short by an upgrade: its end date before the upgrade. */
  originalEndDate: ISODate | null;
  /** On a plan cut short by an upgrade: the credit given for its unused days (0 otherwise). */
  upgradeCredit: number;
  status: CfoGymPlanStatus;
  cancelledOn: ISODate | null;
  cancelId: string | null;
  /** null when the plan has no bill id stored. */
  invoiceId: string | null;
  pauses: CfoPause[];
  paidInOldSoftware: boolean;
  /** Came from the CSV import (`source: "import"`). */
  imported: boolean;
  upgradedTo: string | null;
  /** On a plan cut short by an upgrade: the day the new plan starts (`upgradeFrom` = endDate + 1). */
  upgradeFrom: ISODate | null;
  /** IST date of `createdAt`. */
  createdOn: ISODate;
}

export type CfoPtStatus = "pending" | "active" | "completed" | "cancelled";

export interface CfoPtPlan {
  id: string;
  clientId: string;
  trainerId: string;
  trainerName: string;
  packageName: string;
  /** `ptPrice`: list price before discount. */
  listPrice: number;
  /** Snapshot of the trainer's share at sale time (fallback when no payout lines exist). */
  trainerShareAmount: number;
  startDate: ISODate;
  endDate: ISODate | "";
  status: CfoPtStatus;
  cancelledOn: ISODate | null;
  cancelId: string | null;
  invoiceId: string | null;
  paidInOldSoftware: boolean;
  createdOn: ISODate;
}

export interface CfoPayout {
  id: string;
  ptAssignmentId: string;
  trainerId: string;
  /** Current amount (minus on an adjustment line). */
  trainerShareAmount: number;
  /** Amount before a cancel lowered it (`beforeCancel.trainerShareAmount`), else = trainerShareAmount. */
  originalShare: number;
  status: "pending" | "paid" | "cancelled";
  paidAt: ISODate | null;
  adjustment: boolean;
  /** Sale date of the line (`paymentDate`). */
  date: ISODate;
}

/** A `payments` doc (amount is minus for a refund). */
export interface CfoPayment {
  id: string;
  amount: number;
  paymentDate: ISODate;
  kind: "initial" | "balance" | "refund";
  cancelId: string | null;
  invoiceId: string;
  /** Paid in the old software: received on its day, but never cash in this gym's hands. */
  oldSoftware?: boolean;
}

export interface CfoExpense {
  id: string;
  amount: number;
  date: ISODate;
  category: string;
  /** paidBy === "Gym" (or missing). */
  paidByGym: boolean;
  settled: boolean;
  settledDate: ISODate | null;
}

export interface CfoOtherIncome {
  id: string;
  amount: number;
  date: ISODate;
  category: string;
}

export interface CfoMember {
  id: string;
  name: string;
  phone: string;
  /** Member ID shown in the app ("12"). */
  code: string;
  /** `joinedOn`, else IST date of `createdAt`. */
  joinedOn: ISODate;
  lastVisitDate: ISODate | "";
  thumbSince: ISODate | "";
  /** Thumb registered or a known last visit (same rule as the Calls page). */
  tracked: boolean;
}

export interface CfoTrainer {
  id: string;
  name: string;
  /** From staffPrivate; null when not stored (missing or 0). */
  monthlySalary: number | null;
}

export interface CfoWindow {
  today: ISODate;
  /** First day of the oldest reported month (6 full months before this month). */
  windowStart: ISODate;
  /** First day of last month. */
  lastMonthStart: ISODate;
  /** Oldest first: 6 full months, then this month. */
  months: { key: string; from: ISODate; to: ISODate }[];
}

export interface CfoInput {
  today: ISODate;
  windowStart: ISODate;
  /** Date of the earliest expense record ("" = no expenses yet). */
  firstExpenseDate: ISODate | "";
  bills: CfoBill[];
  gymPlans: CfoGymPlan[];
  ptPlans: CfoPtPlan[];
  payouts: CfoPayout[];
  /** Payments with paymentDate >= min(openingDate, first day of last month), plus every refund. */
  payments: CfoPayment[];
  expenses: CfoExpense[];
  otherIncome: CfoOtherIncome[];
  members: CfoMember[];
  /** clientId → visit days ("YYYY-MM-DD"), from memberVisits. */
  visits: Record<string, ISODate[]>;
  trainers: CfoTrainer[];
  /** Prices of active PT packages (for the PT-chances estimate). */
  ptPackagePrices: number[];
  /** Plans skipped because the end date is missing. */
  plansMissingEndDate: number;
}

/* ------------------------------------------------------------- output snapshot */

export type CfoTone = "good" | "warn" | "bad" | "none";

export interface CfoMonth {
  /** "2026-09" */
  key: string;
  /** "Sep 2026" */
  label: string;
  from: ISODate;
  /** Last day counted (today for the current month). */
  to: ISODate;
  /** true for the current month (counted up to today). */
  partial: boolean;
  daysCounted: number;
  daysInMonth: number;
  /** false before the month of the first expense record: income shown, no profit, not averaged. */
  hasData: boolean;
  /** pt = the gym's share of PT (PT income − trainer share). */
  earned: { gym: number; pt: number; other: number; total: number };
  /** Full PT income and the trainer share inside it (for the PT table). */
  ptIncome: number;
  trainerShare: number;
  /** Money received (payments by date + old bills), same as the Dashboard. */
  received: number;
  expenses: { byCategory: Record<string, number>; total: number };
  profit: number;
  /** Distinct members with a plan on at least one day of the month. */
  activeMembers: number;
  /** Average per day (2 decimals); used for income per member. */
  avgActiveMembers: number;
  newMembers: number;
  plansEnded: number;
  renewed: number;
  notRenewed: number;
  stillDeciding: number;
  leftEarly: number;
  /** 0..1, null when nobody's plan ended (or all still deciding). */
  renewalRate: number | null;
  /** new − not renewed − left early. */
  netGrowth: number;
}

export interface CfoCash {
  set: boolean;
  openingBalance: number | null;
  openingDate: ISODate | "";
  balance: number | null;
  /** "Money that is really yours". */
  freeCash: number | null;
  runwayMonths: number | null;
  parts: {
    payments: number;
    oldBills: number;
    otherIncome: number;
    expensesPaid: number;
    trainerPaid: number;
    /** Subtracted only for free cash. */
    pendingTrainer: number;
    /**
     * The trainers' part of members' advance for unused PT days. It is already counted in
     * trainer pay (pending or paid; a refund takes it back from the trainer), so free cash adds
     * it back instead of subtracting it twice.
     */
    trainerShareInAdvance: number;
    /** Subtracted only for free cash. */
    unsettledStaffPaid: number;
  };
}

export type CfoDueGroup = "notDue" | "d0_7" | "d8_30" | "d30plus";

export interface CfoDueRow {
  billId: string;
  billNumber: string;
  clientId: string;
  name: string;
  phone: string;
  code: string;
  items: string;
  balance: number;
  dueDate: ISODate | "";
  /** Days late (minus = days until due). */
  daysLate: number;
  group: CfoDueGroup;
}

export interface CfoAlertRow {
  clientId: string;
  name: string;
  phone: string;
  code: string;
  plan: string;
  endDate: ISODate | "";
  lastVisit: ISODate | "";
  money: number;
  reason: string;
  /** "notComing" | "dropping" for at-risk rows (picks the WhatsApp text); "" otherwise. */
  kind: string;
  top: boolean;
}

/** Inside `cfoReports/latest`: totals + the first CFO_SUMMARY_ROWS rows. */
export interface CfoListSummary<Row> {
  count: number;
  total: number;
  rows: Row[];
}

/** `cfoReports/list-{key}`: the full list. */
export interface CfoListDoc<Row> {
  key: CfoListKey;
  computedAt: string;
  count: number;
  total: number;
  rows: Row[];
  /** Rows left out to respect the cap / size limit. */
  truncated: number;
}

export interface CfoDues {
  count: number;
  total: number;
  groups: Record<CfoDueGroup, { count: number; amount: number }>;
}

export interface CfoTrainerRow {
  trainerId: string;
  name: string;
  thisMonth: { income: number; trainerShare: number; gymKeeps: number };
  lastMonth: { income: number; trainerShare: number; gymKeeps: number };
  monthlySalary: number | null;
}

export interface CfoSnapshot {
  version: 1;
  /** ISO timestamp (server clock). */
  computedAt: string;
  computedBy: string;
  today: ISODate;
  currency: "INR";
  /** Oldest first: 6 full months, then the current month (partial). */
  months: CfoMonth[];
  thisMonthKey: string;
  lastMonthKey: string;
  avgMonthlyExpenses: number | null;
  avgBasedOnMonths: number;
  activeMembers: number;
  incomePerMember: number | null;
  breakEvenMembers: number | null;
  /** null when break-even is unknown. */
  aboveBreakEven: boolean | null;
  advanceOwed: number;
  cash: CfoCash;
  dues: CfoDues;
  trainers: CfoTrainerRow[];
  lists: {
    atRisk: CfoListSummary<CfoAlertRow>;
    renewals: CfoListSummary<CfoAlertRow>;
    newSlipping: CfoListSummary<CfoAlertRow>;
    ptChances: CfoListSummary<CfoAlertRow>;
    dues: CfoListSummary<CfoDueRow>;
  };
  cashWarning: { on: boolean; reasons: string[] };
  /** Members with a running plan whose visits can't be checked (no thumb, no visit yet). */
  notTracked: number;
  /** Cheapest active PT package price used for "PT from"; null when none. */
  ptFromPrice: number | null;
  /** Plain-language notes about data the maths had to skip or guess ("2 plans have no end date"). */
  dataNotes: string[];
  health: {
    profit: CfoTone;
    breakEven: CfoTone;
    cash: CfoTone;
    freeCash: CfoTone;
    runway: CfoTone;
  };
}

/** What computeCfo returns: the summary doc and the full list docs. */
export interface CfoComputed {
  snapshot: CfoSnapshot;
  lists: {
    atRisk: CfoListDoc<CfoAlertRow>;
    renewals: CfoListDoc<CfoAlertRow>;
    newSlipping: CfoListDoc<CfoAlertRow>;
    ptChances: CfoListDoc<CfoAlertRow>;
    dues: CfoListDoc<CfoDueRow>;
  };
}

/** Extra fields the server keeps on `cfoReports/latest` (not computed by the maths). */
export interface CfoReportMeta {
  /** ISO timestamp while a recompute runs, else "". */
  runningSince: string;
  readCount: number;
  manualBriefs: { date: ISODate; count: number };
  /** ISO timestamp from when Refresh is allowed again (the page greys the button until then). */
  nextRefreshAt: string;
}

/* ------------------------------------------------------------------- AI brief */

/** A month in the brief input: every value pre-formatted exactly as the page shows it. */
export interface CfoBriefMonth {
  month: string;
  earnedIncome: string;
  expenses: string;
  profitOrLoss: string;
  moneyReceived: string;
  renewalRate: string;
  newMembers: string;
  membersLost: string;
}

/**
 * The ONLY object sent to the AI (allow-list). Strings are pre-formatted numbers or fixed words.
 * Never names, phones, member IDs, bill numbers, per-trainer rows, salaries, custom category text,
 * notes or package names.
 */
export interface CfoBriefInput {
  currency: "INR";
  language: CfoLanguage;
  today: string;
  lastFullMonth: CfoBriefMonth;
  thisMonthSoFar: CfoBriefMonth & { daysCounted: string; daysInMonth: string };
  members: { activeToday: string; breakEven: string; aboveOrBelow: string };
  cash: {
    allGymMoney: string;
    reallyYours: string;
    paidInAdvanceByMembers: string;
    monthsOfRunway: string;
  };
  alerts: Record<
    "notComing" | "renewals" | "newMembersSlipping" | "ptChances",
    { members: string; money: string }
  >;
  dues: {
    total: string;
    notDueYet: string;
    late0to7: string;
    late8to30: string;
    lateOver30: string;
  };
  /** Built-in category names only; custom categories are added into "Other (custom)". */
  expensesByCategoryLastMonth: Record<string, string>;
  pt: { gymShareLastMonth: string; trainerShareLastMonth: string; trainers: string };
  cashWarning: string;
  rules: {
    notComingDays: string;
    renewalWindowDays: string;
    newMemberMinVisits: string;
    ptMinVisits: string;
    runwayWarnMonths: string;
    graceDays: string;
  };
}

/** What POST /api/cfo/status says about the AI (never the key). */
export interface CfoAiStatus {
  /** A provider and its key are set on the server and the provider accepts them. */
  connected: boolean;
  provider: string;
  model: string;
  /** Why a configured AI is not working ("the AI key was refused"); "" when fine or not set. */
  problem: string;
}

export type CfoBriefStatus = "ok" | "failed" | "off" | "unverified" | "blocked" | "skipped";

/** `cfoBriefs/latest` (newest OK brief) and `cfoBriefs/{date}-{HHmm}` (history). */
export interface CfoBrief {
  date: ISODate;
  createdAt: string;
  by: string;
  provider: string;
  model: string;
  status: CfoBriefStatus;
  text: string;
  /** The exact object sent to the AI. */
  input: CfoBriefInput | null;
  /** computedAt of the snapshot the brief was written from. */
  snapshotComputedAt: string;
  error: string;
  unknownNumbers: string[];
}

/** `cfoBriefs/status`: the last attempt, OK or not. */
export interface CfoBriefAttempt {
  at: string;
  status: CfoBriefStatus;
  /** Short plain reason, no secrets, no names (≤120 chars). */
  reason: string;
  /** Failed tries only: the provider, model and HTTP status (0 = no answer) of the last call. */
  provider?: string;
  model?: string;
  httpStatus?: number;
}
