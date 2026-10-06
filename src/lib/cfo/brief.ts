/**
 * Layer 3 helpers (CFO_PLAN.md section 5): what the AI is allowed to see, what it is told, and
 * how its answer is checked. The AI only explains; every number comes from our own maths.
 */
import { monthName } from "./dates.ts";
import {
  NOT_ENOUGH_DATA,
  formatCount,
  formatDay,
  formatMonths,
  formatPercent,
  formatRupees,
} from "./money.ts";
import type {
  CfoBriefInput,
  CfoBriefMonth,
  CfoLanguage,
  CfoMonth,
  CfoSettings,
  CfoSnapshot,
} from "./types.ts";

/* ------------------------------------------------------------------ the input */

/** The built-in expense categories. Any other category is added into "Other (custom)". */
const BUILT_IN_CATEGORIES = [
  "Rent",
  "Electricity",
  "Equipment",
  "Staff Salary",
  "Incentive",
  "Maintenance",
  "Marketing",
  "Cleaning",
  "Supplies",
  "Other",
] as const;
const CUSTOM_KEY = "Other (custom)";

const NOT_SET = "not set";
const NO_DATA = NOT_ENOUGH_DATA;
const ABOVE = "above break-even";
const BELOW = "below break-even";

function briefMonth(m: CfoMonth): CfoBriefMonth {
  return {
    month: m.label,
    earnedIncome: formatRupees(m.earned.total),
    expenses: m.hasData ? formatRupees(m.expenses.total) : NO_DATA,
    profitOrLoss: m.hasData ? formatRupees(m.profit) : NO_DATA,
    moneyReceived: formatRupees(m.received),
    renewalRate: formatPercent(m.renewalRate),
    newMembers: formatCount(m.newMembers),
    membersLost: formatCount(m.notRenewed + m.leftEarly),
  };
}

/** A number setting as text: whole numbers with grouping, anything else as is. */
const setting = (n: number) => (Number.isInteger(n) ? formatCount(n) : String(n));

/**
 * Fill the fixed `CfoBriefInput`. Allow-list only: nothing from the snapshot is copied except what
 * is written out here, so no name, phone, id, bill number, package name or salary can slip in.
 */
export function buildBriefInput(snapshot: CfoSnapshot, settings: CfoSettings): CfoBriefInput {
  const last = snapshot.months.find((m) => m.key === snapshot.lastMonthKey);
  const now = snapshot.months.find((m) => m.key === snapshot.thisMonthKey);
  if (!last || !now) throw new Error("snapshot has no months");

  const cats: Record<string, string> = {};
  const byLower = new Map<string, string>(BUILT_IN_CATEGORIES.map((c) => [c.toLowerCase(), c]));
  const amounts = new Map<string, number>();
  let custom = 0;
  for (const [name, amount] of Object.entries(last.expenses.byCategory)) {
    const built = byLower.get(name.trim().toLowerCase());
    if (built) amounts.set(built, (amounts.get(built) ?? 0) + amount);
    else custom += amount;
  }
  for (const c of BUILT_IN_CATEGORIES) {
    cats[c] = last.hasData ? formatRupees(amounts.get(c) ?? 0) : NO_DATA;
  }
  cats[CUSTOM_KEY] = last.hasData ? formatRupees(custom) : NO_DATA;

  const cash = snapshot.cash;
  const list = (l: { count: number; total: number }) => ({
    members: formatCount(l.count),
    money: formatRupees(l.total),
  });
  const g = snapshot.dues.groups;
  return {
    currency: "INR",
    language: settings.language,
    today: formatDay(snapshot.today),
    lastFullMonth: briefMonth(last),
    thisMonthSoFar: {
      ...briefMonth(now),
      daysCounted: formatCount(now.daysCounted),
      daysInMonth: formatCount(now.daysInMonth),
    },
    members: {
      activeToday: formatCount(snapshot.activeMembers),
      breakEven: formatCount(snapshot.breakEvenMembers),
      aboveOrBelow:
        snapshot.aboveBreakEven === null ? NO_DATA : snapshot.aboveBreakEven ? ABOVE : BELOW,
    },
    cash: {
      allGymMoney: cash.set && cash.balance !== null ? formatRupees(cash.balance) : NOT_SET,
      reallyYours: cash.set && cash.freeCash !== null ? formatRupees(cash.freeCash) : NOT_SET,
      paidInAdvanceByMembers: formatRupees(snapshot.advanceOwed),
      monthsOfRunway: cash.set ? formatMonths(cash.runwayMonths) : NOT_SET,
    },
    alerts: {
      notComing: list(snapshot.lists.atRisk),
      renewals: list(snapshot.lists.renewals),
      newMembersSlipping: list(snapshot.lists.newSlipping),
      ptChances: list(snapshot.lists.ptChances),
    },
    dues: {
      total: formatRupees(snapshot.dues.total),
      notDueYet: formatRupees(g.notDue.amount),
      late0to7: formatRupees(g.d0_7.amount),
      late8to30: formatRupees(g.d8_30.amount),
      lateOver30: formatRupees(g.d30plus.amount),
    },
    expensesByCategoryLastMonth: cats,
    pt: {
      gymShareLastMonth: formatRupees(last.earned.pt),
      trainerShareLastMonth: formatRupees(last.trainerShare),
      trainers: formatCount(snapshot.trainers.length),
    },
    cashWarning: snapshot.cashWarning.on ? `Yes: ${snapshot.cashWarning.reasons.join(" ")}` : "No",
    rules: {
      notComingDays: setting(settings.atRiskDays),
      renewalWindowDays: setting(settings.renewalDays),
      newMemberMinVisits: setting(settings.newMemberMinVisits),
      ptMinVisits: setting(settings.ptMinVisits),
      runwayWarnMonths: setting(settings.runwayWarnMonths),
      graceDays: setting(settings.graceDays),
    },
  };
}

/* ------------------------------------------------------------- system prompt */

const PROMPT_BASE =
  "You are the CFO of a gym. You are writing to the owner, who is not a finance person. " +
  "Use short, simple sentences. Use only the numbers given in the data. " +
  "Never calculate or invent a number. If a number is missing, say it is not available. " +
  'Write three parts: (1) "Where you stand": 2 to 3 lines on profit or loss, break-even, and cash runway. ' +
  '(2) "What is going wrong": the 2 to 3 biggest problems by money. ' +
  '(3) "Do this week": exactly 3 actions, each tied to a number in the data. ' +
  "Keep it under 150 words.";

const PROMPT_EXTRA =
  'Judge "Where you stand" on the last full month; mention this month only as so far. ' +
  "Write every number in 0-9 digits exactly as in the data (e.g. ₹1,90,000). " +
  "Never use words for numbers, lakh or crore, another script's digits, or dates.";

export function briefSystemPrompt(language: CfoLanguage): string {
  return `${PROMPT_BASE} ${PROMPT_EXTRA} Write in ${language}.`;
}

/* ------------------------------------------------------------- privacy check */

/** Keys and fixed words the brief can contain. A name that equals one of these is not a leak. */
const FIXED_TEXT = [
  // keys
  "currency language today lastFullMonth thisMonthSoFar month earnedIncome expenses profitOrLoss",
  "moneyReceived renewalRate newMembers membersLost daysCounted daysInMonth members activeToday",
  "breakEven aboveOrBelow cash allGymMoney reallyYours paidInAdvanceByMembers monthsOfRunway",
  "alerts notComing renewals newMembersSlipping ptChances money dues total notDueYet late0to7",
  "late8to30 lateOver30 expensesByCategoryLastMonth pt gymShareLastMonth trainerShareLastMonth",
  "trainers cashWarning rules notComingDays renewalWindowDays newMemberMinVisits ptMinVisits",
  "runwayWarnMonths graceDays",
  // fixed values
  "INR English Telugu Hindi No Yes not set not enough data above break-even below break-even",
  "months month Other (custom)",
  BUILT_IN_CATEGORIES.join(" "),
  "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec",
  // the cash warning sentences written by numbers.ts
  "All the gym's money has run out.",
  "Money lasts months if no new money comes in (warning below months).",
  "Active members are below the break-even number.",
].join(" ");

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
}

/** Lower-case words of the fixed vocabulary, including the pieces of camelCase keys. */
export const BRIEF_VOCABULARY: ReadonlySet<string> = new Set(
  FIXED_TEXT.split(/\s+/).flatMap((token) => {
    const pieces = token.replace(/([a-z])([A-Z])/g, "$1 $2");
    return [...wordsOf(token), ...wordsOf(pieces)];
  }),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Backup guard for the request to the AI. Fails on a long digit run (a phone number) or on a
 * member / trainer name that appears as a whole word. The reason never repeats the name.
 */
export function briefPrivacyCheck(
  json: string,
  names: string[],
): { ok: true } | { ok: false; reason: string } {
  const compact = json.replace(/(?<=\d)[\s-]+(?=\d)/g, "");
  if (/\d{10,}/.test(compact)) {
    return { ok: false, reason: "a long number that could be a phone number" };
  }
  const lower = json.toLowerCase();
  for (const name of names) {
    for (const raw of name.split(/\s+/)) {
      const part = raw.replace(/[^\p{L}\p{M}]+/gu, "").toLowerCase();
      if (part.length < 3 || BRIEF_VOCABULARY.has(part)) continue;
      const re = new RegExp(
        `(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(part)}(?![\\p{L}\\p{M}\\p{N}])`,
        "u",
      );
      if (re.test(lower)) return { ok: false, reason: "a member or trainer name" };
    }
  }
  return { ok: true };
}

/* -------------------------------------------------------------- number check */

const TELUGU_ZERO = 0x0c66;
const DEVANAGARI_ZERO = 0x0966;

/** Telugu and Devanagari digits to 0-9 (same length, so positions stay the same). */
function asciiDigits(s: string): string {
  return s.replace(/[०-९౦-౯]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= TELUGU_ZERO ? code - TELUGU_ZERO : code - DEVANAGARI_ZERO);
  });
}

const NUMBER_RE = /\d+(?:,\d+)*(?:\.\d+)?/g;
/** A unit that turns a number into something we never print: lakh, crore, K, L (any script). */
const UNIT_RE =
  /^\s*-?\s*(lakhs?|lacs?|crores?|cr|k|l|లక్ష|लाख|करोड़|करोड|కోటి|కోట్లు)(?![\p{L}\p{M}])/iu;

function canon(token: string): string {
  const t = token.replace(/,/g, "");
  const [intPart = "", frac] = t.split(".");
  const i = intPart.replace(/^0+(?=\d)/, "");
  if (frac === undefined) return i;
  const f = frac.replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out);
  return out;
}

/** Every number the AI may repeat: all numbers in the data, today's parts, and 1, 2, 3. */
function allowedNumbers(input: CfoBriefInput): Set<string> {
  const allowed = new Set<string>(["1", "2", "3"]);
  for (const s of collectStrings(input)) {
    for (const m of asciiDigits(s).matchAll(NUMBER_RE)) allowed.add(canon(m[0]));
  }
  for (const w of input.today.match(/[A-Za-z]{3}/g) ?? []) {
    const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((n) => monthName(n) === w);
    if (idx !== undefined) allowed.add(String(idx));
  }
  return allowed;
}

/**
 * Every number in the AI text must be one of the numbers in the data (exact match), written in
 * 0-9 digits. A number followed by lakh / crore / K / L is never accepted.
 */
export function verifyBriefNumbers(
  text: string,
  input: CfoBriefInput,
): { ok: boolean; unknown: string[] } {
  const allowed = allowedNumbers(input);
  const t = asciiDigits(text);
  const unknown: string[] = [];
  const add = (s: string) => {
    if (!unknown.includes(s)) unknown.push(s);
  };
  for (const m of t.matchAll(NUMBER_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    const unit = UNIT_RE.exec(t.slice(end));
    if (unit) add(`${m[0]} ${unit[1] ?? ""}`.trim());
    else if (!allowed.has(canon(m[0]))) add(m[0]);
  }
  // Digits of any other script cannot be checked, so they are refused.
  for (const m of t.matchAll(/[\p{Nd}]+/gu)) {
    if (/[\u0080-￿]/.test(m[0])) add(m[0]);
  }
  return { ok: unknown.length === 0, unknown };
}
