import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRIEF_VOCABULARY,
  briefPrivacyCheck,
  briefSystemPrompt,
  buildBriefInput,
  verifyBriefNumbers,
} from "./brief.ts";
import { formatCount, formatPercent, formatRupees } from "./money.ts";
import { computeCfo } from "./numbers.ts";
import {
  DEFAULT_CFO_SETTINGS,
  type CfoBriefInput,
  type CfoInput,
  type CfoSettings,
} from "./types.ts";
import {
  bill,
  expense,
  gymBilled,
  income,
  input,
  member,
  payout,
  pt,
  trainer,
  withPlans,
} from "./testkit.ts";

const META = { computedAt: "2026-10-06T02:30:00.000Z", computedBy: "test" };

/** A small gym with names, a trainer, custom expense categories and a cash warning. */
function sample(): CfoInput {
  const a = gymBilled("gA", "A", "2026-01-01", "2026-12-31", 3650);
  const b = gymBilled("gB", "B", "2026-09-01", "2026-09-30", 190000, {
    plan: { status: "expired" },
  });
  return withPlans(
    input({
      firstExpenseDate: "2026-07-05",
      members: [
        member({ id: "A", name: "Ravi Teja Kandula", phone: "9876543210", code: "17" }),
        member({ id: "B", name: "Lakshmi Prasanna", phone: "9123456780", code: "18" }),
      ],
      trainers: [trainer({ id: "t1", name: "Coach Venkatesh", monthlySalary: 15000 })],
      ptPlans: [
        pt({
          id: "p1",
          clientId: "A",
          trainerId: "t1",
          trainerName: "Coach Venkatesh",
          packageName: "Zumba Special Pack",
          listPrice: 3000,
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
      ],
      bills: [
        bill({
          id: "b-p1",
          number: "INV-90210",
          clientId: "A",
          subtotal: 3000,
          ptAssignmentId: "p1",
          ptGross: 3000,
        }),
      ],
      payouts: [payout({ id: "po", ptAssignmentId: "p1", trainerShareAmount: 900 })],
      expenses: [
        expense({ id: "e1", amount: 1000, date: "2026-07-05", category: "Rent" }),
        expense({ id: "e2", amount: 2000, date: "2026-08-02", category: "Rent" }),
        expense({ id: "e3", amount: 2000, date: "2026-09-02", category: "rent" }),
        expense({ id: "e4", amount: 500, date: "2026-09-10", category: "Electricity" }),
        expense({ id: "e5", amount: 100, date: "2026-09-11", category: "Secret Chai Fund" }),
        expense({ id: "e6", amount: 50, date: "2026-09-12", category: "Goat Feed" }),
      ],
      otherIncome: [income({ id: "i1", amount: 200, date: "2026-09-03" })],
    }),
    a,
    b,
  );
}

const compute = (i: CfoInput, s: Partial<CfoSettings> = {}) =>
  computeCfo(i, { ...DEFAULT_CFO_SETTINGS, ...s }, META).snapshot;
const briefOf = (i: CfoInput, s: Partial<CfoSettings> = {}) =>
  buildBriefInput(compute(i, s), { ...DEFAULT_CFO_SETTINGS, ...s });

/* ------------------------------------------------------------ buildBriefInput */

test("brief input has exactly the allow-listed fields", () => {
  const b = briefOf(sample());
  assert.deepEqual(Object.keys(b).sort(), [
    "alerts",
    "cash",
    "cashWarning",
    "currency",
    "dues",
    "expensesByCategoryLastMonth",
    "language",
    "lastFullMonth",
    "members",
    "pt",
    "rules",
    "thisMonthSoFar",
    "today",
  ]);
  assert.deepEqual(Object.keys(b.lastFullMonth).sort(), [
    "earnedIncome",
    "expenses",
    "membersLost",
    "moneyReceived",
    "month",
    "newMembers",
    "profitOrLoss",
    "renewalRate",
  ]);
  assert.deepEqual(Object.keys(b.alerts).sort(), [
    "newMembersSlipping",
    "notComing",
    "ptChances",
    "renewals",
  ]);
  assert.deepEqual(Object.keys(b.rules).sort(), [
    "graceDays",
    "newMemberMinVisits",
    "notComingDays",
    "ptMinVisits",
    "renewalWindowDays",
    "runwayWarnMonths",
  ]);
});

test("brief values are pre-formatted exactly as the page shows them", () => {
  const snap = compute(sample());
  const b = buildBriefInput(snap, DEFAULT_CFO_SETTINGS);
  const sep = snap.months.find((m) => m.key === "2026-09")!;
  assert.equal(b.currency, "INR");
  assert.equal(b.language, "English");
  assert.equal(b.today, "6 Oct 2026");
  assert.equal(b.lastFullMonth.month, "Sep 2026");
  assert.equal(b.lastFullMonth.earnedIncome, formatRupees(sep.earned.total));
  assert.equal(b.lastFullMonth.expenses, formatRupees(sep.expenses.total));
  assert.equal(b.lastFullMonth.profitOrLoss, formatRupees(sep.profit));
  assert.equal(b.lastFullMonth.moneyReceived, formatRupees(sep.received));
  assert.equal(b.lastFullMonth.renewalRate, formatPercent(sep.renewalRate));
  assert.equal(b.lastFullMonth.newMembers, formatCount(sep.newMembers));
  assert.equal(b.members.activeToday, formatCount(snap.activeMembers));
  assert.equal(b.dues.total, formatRupees(snap.dues.total));
  assert.equal(b.thisMonthSoFar.daysCounted, "6");
  assert.equal(b.thisMonthSoFar.daysInMonth, "31");
  assert.equal(b.rules.notComingDays, "14");
  assert.equal(b.rules.graceDays, "15");
  assert.equal(b.rules.runwayWarnMonths, "2");
});

test("brief: built-in categories are named, every custom category is added into 'Other (custom)'", () => {
  const b = briefOf(sample());
  const cats = b.expensesByCategoryLastMonth;
  assert.deepEqual(Object.keys(cats), [
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
    "Other (custom)",
  ]);
  assert.equal(cats["Rent"], "₹2,000"); // "rent" in lower case still counts as Rent
  assert.equal(cats["Electricity"], "₹500");
  assert.equal(cats["Equipment"], "₹0");
  assert.equal(cats["Other (custom)"], "₹150"); // 100 + 50
  const json = JSON.stringify(b);
  assert.ok(!/Secret Chai|Goat Feed/i.test(json));
});

test("brief never carries names, phones, ids, bill numbers, package names, salaries or trainers", () => {
  const json = JSON.stringify(briefOf(sample()));
  for (const bad of [
    "Ravi",
    "Teja",
    "Kandula",
    "Lakshmi",
    "Prasanna",
    "Venkatesh",
    "Coach",
    "9876543210",
    "9123456780",
    "INV-90210",
    "Zumba",
    "15,000",
    "15000",
  ]) {
    assert.ok(!json.includes(bad), `found ${bad}`);
  }
});

test("brief: cash is 'not set' until opening money is saved; unknown numbers say 'not enough data'", () => {
  const b = briefOf(sample());
  assert.equal(b.cash.allGymMoney, "not set");
  assert.equal(b.cash.reallyYours, "not set");
  assert.equal(b.cash.monthsOfRunway, "not set");
  assert.match(b.cash.paidInAdvanceByMembers, /^₹/);
  assert.equal(b.lastFullMonth.renewalRate, "not enough data");

  const set = briefOf(sample(), { openingBalance: 50000, openingDate: "2026-09-01" });
  assert.match(set.cash.allGymMoney, /^₹/);
  assert.match(set.cash.monthsOfRunway, /months$/);
});

test("brief: months without expense records say 'not enough data' for profit and expenses", () => {
  const b = briefOf(input());
  assert.equal(b.lastFullMonth.expenses, "not enough data");
  assert.equal(b.lastFullMonth.profitOrLoss, "not enough data");
  assert.equal(b.members.breakEven, "not enough data");
  assert.equal(b.members.aboveOrBelow, "not enough data");
  assert.equal(b.expensesByCategoryLastMonth["Rent"], "not enough data");
});

test("brief: cash warning is a fixed sentence, 'No' when everything is fine", () => {
  const warn = briefOf(sample(), { openingBalance: -50, openingDate: "2026-10-01" });
  assert.match(warn.cashWarning, /^Yes: /);
  assert.equal(briefOf(input()).cashWarning, "No");
});

test("brief language comes from the settings", () => {
  assert.equal(briefOf(sample(), { language: "Telugu" }).language, "Telugu");
});

test("every word the brief can produce is in the fixed vocabulary (so the privacy check cannot misfire)", () => {
  const variants: CfoBriefInput[] = [
    briefOf(sample()),
    briefOf(sample(), { openingBalance: 50000, openingDate: "2026-09-01", language: "Hindi" }),
    briefOf(sample(), { openingBalance: -5, openingDate: "2026-10-01", language: "Telugu" }),
    briefOf(sample(), { openingBalance: 1500, openingDate: "2026-10-01" }),
    briefOf(input()),
  ];
  for (const v of variants) {
    const text = JSON.stringify(v);
    for (const w of text.match(/\p{L}[\p{L}\p{M}]{2,}/gu) ?? []) {
      assert.ok(BRIEF_VOCABULARY.has(w.toLowerCase()), `word "${w}" is not in the vocabulary`);
    }
  }
});

/* --------------------------------------------------------------- system prompt */

test("system prompt carries the spec rules, the extra lines and the language", () => {
  const p = briefSystemPrompt("Telugu");
  assert.match(p, /You are the CFO of a gym/);
  assert.match(p, /Never calculate or invent a number/);
  assert.match(p, /Where you stand/);
  assert.match(p, /What is going wrong/);
  assert.match(p, /Do this week/);
  assert.match(p, /exactly 3 actions/);
  assert.match(p, /under 150 words/);
  assert.match(p, /last full month/);
  assert.match(p, /0-9 digits/);
  assert.match(p, /lakh or crore/);
  assert.match(p, /Write in Telugu\./);
  assert.match(briefSystemPrompt("Hindi"), /Write in Hindi\./);
  assert.ok(!/language given in the data/.test(p));
});

/* -------------------------------------------------------------- privacy check */

test("privacy check passes a clean brief with real member names around", () => {
  const json = JSON.stringify(briefOf(sample()));
  assert.deepEqual(
    briefPrivacyCheck(json, ["Ravi Teja Kandula", "Lakshmi Prasanna", "Coach Venkatesh"]),
    {
      ok: true,
    },
  );
});

test("privacy check fails on a run of 10 or more digits", () => {
  const r = briefPrivacyCheck('{"x":"call 9876543210 now"}', []);
  assert.equal(r.ok, false);
  assert.equal(briefPrivacyCheck('{"x":"123456789"}', []).ok, true); // 9 digits
  assert.equal(briefPrivacyCheck('{"x":"98765 43210"}', []).ok, false); // phone with a space
  assert.equal(briefPrivacyCheck('{"x":"₹12,34,56,789"}', []).ok, true); // commas break the run
});

test("privacy check fails on a whole-word match of a name part (3+ letters), any case", () => {
  const r = briefPrivacyCheck('{"x":"talk to RAVI today"}', ["Ravi Teja"]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(!/ravi/i.test(r.reason), "the reason must not repeat the name");
    assert.ok(r.reason.length > 0);
  }
  assert.equal(briefPrivacyCheck('{"x":"teja"}', ["Ravi Teja"]).ok, false);
});

test("privacy check ignores short name parts, partial words and fixed vocabulary words", () => {
  assert.equal(briefPrivacyCheck('{"x":"Mo and Jo"}', ["Mo Jo"]).ok, true); // under 3 letters
  assert.equal(briefPrivacyCheck('{"x":"Travis"}', ["Ravi"]).ok, true); // not a whole word
  assert.equal(briefPrivacyCheck('{"rent":"₹5"}', ["Rent Kumar"]).ok, true); // vocabulary word
  assert.equal(briefPrivacyCheck('{"rent":"kumar"}', ["Rent Kumar"]).ok, false);
});

test("privacy check handles names in other scripts and punctuation", () => {
  assert.equal(briefPrivacyCheck('{"x":"రవి తేజ"}', ["రవి తేజ"]).ok, false);
  assert.equal(briefPrivacyCheck('{"x":"anil"}', ["Dr. Anil, MD"]).ok, false);
});

/* ----------------------------------------------------------------- number check */

function numbersInput(): CfoBriefInput {
  const b = briefOf(sample());
  b.lastFullMonth.earnedIncome = "₹1,90,000";
  b.lastFullMonth.renewalRate = "70%";
  b.cash.monthsOfRunway = "2.4 months";
  return b;
}

test("numbers: the same numbers pass, with or without the rupee sign and commas", () => {
  const b = numbersInput();
  assert.deepEqual(
    verifyBriefNumbers("Income was ₹1,90,000 and renewals 70%. Runway 2.4 months.", b),
    {
      ok: true,
      unknown: [],
    },
  );
  assert.equal(verifyBriefNumbers("Income 190000, runway 2.40 months", b).ok, true);
});

test("numbers: Rs 90,000 does not pass when only Rs 1,90,000 is in the data (exact match, not substring)", () => {
  const b = numbersInput();
  const r = verifyBriefNumbers("You earned ₹90,000 last month.", b);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ["90,000"]);
  assert.equal(verifyBriefNumbers("You earned 190 last month.", b).ok, false);
  assert.equal(verifyBriefNumbers("Runway is 2.41 months.", b).ok, false);
  assert.equal(verifyBriefNumbers("Renewals are 7%.", b).ok, false);
});

test("numbers: lakh, crore, K and L are never allowed, even for numbers that match", () => {
  const b = numbersInput();
  for (const text of [
    "Income was 1.9 lakh.",
    "Income was ₹1.9 lakhs.",
    "Income 5 crore",
    "Income 5 Cr",
    "Income 190K",
    "Income 2 L",
    "Income 1,90,000 lakh",
    "आय 5 लाख",
    "ఆదాయం 5 లక్ష",
    "ఆదాయం ౫ లక్షలు",
  ]) {
    const r = verifyBriefNumbers(text, b);
    assert.equal(r.ok, false, text);
    assert.ok(r.unknown.length > 0, text);
  }
  assert.deepEqual(verifyBriefNumbers("Income was 1.9 lakh.", b).unknown, ["1.9 lakh"]);
  // ordinary words that merely start with those letters are fine
  assert.equal(verifyBriefNumbers("Renewals 70% and 3 klaxons", b).ok, true);
});

test("numbers: Telugu and Hindi digits are mapped to 0-9 first", () => {
  const b = numbersInput();
  assert.equal(verifyBriefNumbers("ఆదాయం ₹౧,౯౦,౦౦౦", b).ok, true); // 1,90,000 in Telugu digits
  assert.equal(verifyBriefNumbers("आय ₹१,९०,०००", b).ok, true); // Devanagari
  assert.equal(verifyBriefNumbers("ఆదాయం ₹౯౦,౦౦౦", b).ok, false); // 90,000 in Telugu digits
  assert.equal(verifyBriefNumbers("आय ₹९०,०००", b).ok, false);
  assert.equal(verifyBriefNumbers("రెన్యువల్ ౭౦%", b).ok, true); // 70
});

test("numbers: digits of any other script are refused", () => {
  const r = verifyBriefNumbers("Income ٣٠٠", numbersInput()); // Arabic-Indic digits
  assert.equal(r.ok, false);
});

test("numbers: today's day, month and year, and 1, 2, 3 are always allowed", () => {
  const b = numbersInput(); // today is 6 Oct 2026
  assert.equal(verifyBriefNumbers("As of 6 Oct 2026 (month 10): do 1, 2 and 3.", b).ok, true);
  const r = verifyBriefNumbers("Do 7777 things.", b);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ["7777"]);
});

test("numbers: a plain text with no numbers is fine, an empty text too", () => {
  assert.equal(verifyBriefNumbers("", numbersInput()).ok, true);
  assert.equal(verifyBriefNumbers("Things look healthy.", numbersInput()).ok, true);
});

test("numbers: every number that is in the data passes when the brief repeats the data", () => {
  const b = briefOf(sample(), { openingBalance: 50000, openingDate: "2026-09-01" });
  const values = (v: unknown): string[] =>
    typeof v === "string" ? [v] : Object.values(v as object).flatMap(values);
  const r = verifyBriefNumbers(values(b).join(" . "), b); // values only: keys like late0to7 are not data
  assert.deepEqual(r, { ok: true, unknown: [] });
});

test("numbers: duplicates are reported once", () => {
  const r = verifyBriefNumbers("₹90,000 and again ₹90,000", numbersInput());
  assert.deepEqual(r.unknown, ["90,000"]);
});
