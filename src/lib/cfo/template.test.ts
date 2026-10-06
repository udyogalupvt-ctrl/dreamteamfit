import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBriefInput, verifyBriefNumbers } from "./brief.ts";
import { computeCfo } from "./numbers.ts";
import { templateBrief } from "./template.ts";
import { DEFAULT_CFO_SETTINGS, type CfoInput, type CfoSettings } from "./types.ts";
import { bill, expense, gymBilled, input, member, withPlans } from "./testkit.ts";

const META = { computedAt: "2026-10-06T02:30:00.000Z", computedBy: "test" };
const settingsOf = (s: Partial<CfoSettings> = {}): CfoSettings => ({
  ...DEFAULT_CFO_SETTINGS,
  ...s,
});
const snapOf = (i: CfoInput, s: Partial<CfoSettings> = {}) =>
  computeCfo(i, settingsOf(s), META).snapshot;

/** A gym with something on every list: a member not coming, a renewal, a late due. */
function busy(): CfoInput {
  // A: yearly plan, last visit 1 Sep (not coming). B: monthly plan ending in 10 days, unpaid part.
  const a = gymBilled("gA", "A", "2026-01-01", "2026-12-31", 3650);
  const b = gymBilled("gB", "B", "2026-09-17", "2026-10-16", 1500, { paid: 1000 });
  return withPlans(
    input({
      firstExpenseDate: "2026-07-01",
      members: [
        member({ id: "A", name: "Ravi", lastVisitDate: "2026-09-01", tracked: true }),
        member({ id: "B", name: "Sita", lastVisitDate: "2026-10-05", tracked: true }),
      ],
      visits: { A: ["2026-09-01"], B: ["2026-10-05"] },
      bills: [
        bill({
          id: "late",
          clientId: "B",
          subtotal: 800,
          amountPaid: 0,
          dueDate: "2026-08-20",
          invoiceDate: "2026-08-01",
        }),
      ],
      expenses: [
        expense({ id: "e1", amount: 900, date: "2026-07-03", category: "Rent" }),
        expense({ id: "e2", amount: 900, date: "2026-08-03", category: "Rent" }),
        expense({ id: "e3", amount: 900, date: "2026-09-03", category: "Rent" }),
      ],
    }),
    a,
    b,
  );
}

function parts(text: string) {
  const lines = text.split("\n").map((l) => l.trim());
  const actions = lines.filter((l) => /^[123]\. /.test(l));
  return { lines, actions };
}

function assertGood(text: string, snapshot: ReturnType<typeof snapOf>, s: CfoSettings) {
  const { lines, actions } = parts(text);
  for (const h of ["Where you stand", "What is going wrong", "Do this week"]) {
    assert.ok(lines.includes(h), `heading "${h}" missing in:\n${text}`);
  }
  assert.equal(actions.length, 3, `exactly 3 actions:\n${text}`);
  assert.doesNotMatch(text, /NaN|undefined|null|Infinity/);
  // Same rule as the AI: every number must be one the page shows.
  const check = verifyBriefNumbers(text, buildBriefInput(snapshot, s));
  assert.ok(check.ok, `numbers not on the page: ${check.unknown.join(", ")}\n${text}`);
}

test("template: a busy gym gets 3 parts, 3 actions, only numbers from the page", () => {
  const s = settingsOf({ openingBalance: 5000, openingDate: "2026-09-01" });
  const snap = snapOf(busy(), s);
  const text = templateBrief(snap, s);
  assertGood(text, snap, s);
  assert.match(text, /not coming/); // the member who stopped coming is named as a problem
});

test("template: a brand-new gym with no data still reads well", () => {
  const s = settingsOf();
  const snap = snapOf(input({}), s);
  const text = templateBrief(snap, s);
  assertGood(text, snap, s);
  assert.match(text, /opening money/i); // asks for the opening money when it is not set
});

test("template: a cash warning comes first in Do this week", () => {
  const s = settingsOf({ openingBalance: 100, openingDate: "2026-09-01" });
  const snap = snapOf(busy(), s);
  assert.equal(snap.cashWarning.on, true);
  const text = templateBrief(snap, s);
  assertGood(text, snap, s);
  assert.match(parts(text).actions[0]!, /money lasts|spending/i);
});

test("template: a month with a loss says so in plain words", () => {
  const s = settingsOf();
  const i = busy();
  i.expenses.push(expense({ id: "big", amount: 50000, date: "2026-09-20", category: "Equipment" }));
  const snap = snapOf(i, s);
  const text = templateBrief(snap, s);
  assertGood(text, snap, s);
  assert.match(text, /loss/);
});
