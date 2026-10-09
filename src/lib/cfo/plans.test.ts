import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanBook, earnedInRange, lifetimeOf, makeSpread } from "./plans.ts";
import type { CfoInput } from "./types.ts";
import { bill, gym, input, payment, payout, pt } from "./testkit.ts";

const close = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} expected ${b}, got ${a}`);

function gymOf(i: CfoInput, id: string) {
  const e = buildPlanBook(i).gym.find((g) => g.plan.id === id);
  assert.ok(e, `gym plan ${id} missing`);
  return e;
}
function ptOf(i: CfoInput, id: string) {
  const e = buildPlanBook(i).pt.find((g) => g.plan.id === id);
  assert.ok(e, `pt plan ${id} missing`);
  return e;
}

/* ------------------------------------------------------------ spreading (4.2) */

test("spread: even over the days, 12 days of Rs 1200 is Rs 100 a day", () => {
  const s = makeSpread({ start: "2026-09-01", end: "2026-09-12", pauses: [], value: 1200 });
  close(earnedInRange(s, "2026-09-01", "2026-09-06"), 600); // 6 days x 100
  close(earnedInRange(s, "2026-09-07", "2026-09-30"), 600);
  close(earnedInRange(s, "2026-08-01", "2026-08-31"), 0);
  close(lifetimeOf(s), 1200);
});

test("spread: paused days earn nothing and the rest earn more", () => {
  // 12 calendar days, pause on the 5th for 2 days -> 10 active days -> Rs 100 a day.
  const s = makeSpread({
    start: "2026-09-01",
    end: "2026-09-12",
    pauses: [{ on: "2026-09-05", days: 2 }],
    value: 1000,
  });
  close(earnedInRange(s, "2026-09-01", "2026-09-06"), 400); // days 1-4 active, 5-6 paused
  close(earnedInRange(s, "2026-09-05", "2026-09-06"), 0);
  close(earnedInRange(s, "2026-09-01", "2026-09-30"), 1000);
});

test("spread: overlapping and stacked pauses count each paused day once", () => {
  // pauses 5..7 and 6..8 overlap -> 5..8 = 4 days. 12 days - 4 = 8 active, Rs 800 -> Rs 100 a day.
  const s = makeSpread({
    start: "2026-09-01",
    end: "2026-09-12",
    pauses: [
      { on: "2026-09-05", days: 3 },
      { on: "2026-09-06", days: 3 },
    ],
    value: 800,
  });
  close(earnedInRange(s, "2026-09-01", "2026-09-04"), 400);
  close(earnedInRange(s, "2026-09-09", "2026-09-12"), 400);
  close(earnedInRange(s, "2026-09-05", "2026-09-08"), 0);
});

test("spread: month split of a yearly plan, 365 days of Rs 3650 is Rs 10 a day", () => {
  const s = makeSpread({ start: "2026-01-01", end: "2026-12-31", pauses: [], value: 3650 });
  close(earnedInRange(s, "2026-02-01", "2026-02-28"), 280); // 28 days
  close(earnedInRange(s, "2026-03-01", "2026-03-31"), 310); // 31 days
});

test("spread: stop day books the final value, even when it is lower than what was earned", () => {
  // Rs 1200 over 12 days, stops on the 7th, final Rs 400. Days 1-6 earn 600; the 7th books 400 - 600 = -200.
  const s = makeSpread({
    start: "2026-09-01",
    end: "2026-09-12",
    pauses: [],
    value: 1200,
    stopOn: "2026-09-07",
    final: 400,
  });
  close(earnedInRange(s, "2026-09-01", "2026-09-06"), 600);
  close(earnedInRange(s, "2026-09-07", "2026-09-07"), -200);
  close(earnedInRange(s, "2026-09-08", "2026-09-30"), 0);
  close(lifetimeOf(s), 400);
});

test("spread: bad or missing end date puts everything on the start day", () => {
  const s = makeSpread({ start: "2026-09-03", end: "", pauses: [], value: 500 });
  assert.equal(s.bad, true);
  close(earnedInRange(s, "2026-09-03", "2026-09-03"), 500);
  close(earnedInRange(s, "2026-09-04", "2026-12-31"), 0);
  close(lifetimeOf(s), 500);
});

test("spread: end before start is bad too", () => {
  const s = makeSpread({ start: "2026-09-10", end: "2026-09-01", pauses: [], value: 100 });
  assert.equal(s.bad, true);
});

/* ------------------------------------------------------- plan value and paid (4.1) */

test("value: a plain paid bill gives value = paid = what was billed", () => {
  const i = input({
    gymPlans: [gym({ id: "g1" })],
    bills: [bill({ id: "b-g1", subtotal: 1200, membershipId: "g1", membershipGross: 1200 })],
  });
  const e = gymOf(i, "g1");
  close(e.value, 1200);
  close(e.paid, 1200);
});

test("value: a Rs 0 bill gives 0 and the plan still exists", () => {
  const i = input({
    gymPlans: [gym({ id: "g1" })],
    bills: [bill({ id: "b-g1", subtotal: 0, membershipId: "g1" })],
  });
  const e = gymOf(i, "g1");
  assert.equal(e.value, 0);
  assert.equal(e.paid, 0);
});

test("value: a 100% discount gives 0 value, 0 paid", () => {
  const i = input({
    gymPlans: [gym({ id: "g1" })],
    bills: [bill({ id: "b-g1", subtotal: 1200, discount: 1200, membershipId: "g1" })],
  });
  const e = gymOf(i, "g1");
  assert.equal(e.value, 0);
  assert.equal(e.paid, 0);
});

test("value: tax is taken out (1000 - 200 discount + 144 tax: value 800, paid 800)", () => {
  // 18% of 800 = 144. total 944, all paid. cashExTax = 944 x 800 / 944 = 800.
  const i = input({
    gymPlans: [gym({ id: "g1" })],
    bills: [bill({ id: "b-g1", subtotal: 1000, discount: 200, tax: 144, membershipId: "g1" })],
  });
  const e = gymOf(i, "g1");
  close(e.value, 800);
  close(e.paid, 800);
});

test("value: part payment on a tax bill takes the tax share out of what was paid", () => {
  // value 800, total 944, paid 472 (half) -> ex-tax paid 472 x 800/944 = 400.
  const i = input({
    gymPlans: [gym({ id: "g1" })],
    bills: [
      bill({
        id: "b-g1",
        subtotal: 1000,
        discount: 200,
        tax: 144,
        amountPaid: 472,
        membershipId: "g1",
      }),
    ],
  });
  const e = gymOf(i, "g1");
  close(e.value, 800);
  close(e.paid, 400);
});

test("value: gym + PT on one bill share the discount and the cash in proportion", () => {
  // list: gym 1000 + PT 500 = 1500, discount 150 -> base 1350: gym 900, PT 450.
  // paid 900 of 1350: shared 900:450 -> gym 600, PT 300.
  const i = input({
    gymPlans: [gym({ id: "g1", invoiceId: "bb" })],
    ptPlans: [pt({ id: "p1", invoiceId: "bb" })],
    bills: [
      bill({
        id: "bb",
        subtotal: 1500,
        discount: 150,
        amountPaid: 900,
        membershipId: "g1",
        ptAssignmentId: "p1",
        membershipGross: 1000,
        ptGross: 500,
      }),
    ],
  });
  const g = gymOf(i, "g1");
  const p = ptOf(i, "p1");
  close(g.value, 900);
  close(p.value, 450);
  close(g.paid, 600);
  close(p.paid, 300);
});

test("value: an unknown gross falls back to the list price of the plan", () => {
  const i = input({
    gymPlans: [gym({ id: "g1", listPrice: 1000 })],
    bills: [bill({ id: "b-g1", subtotal: 1000, membershipId: "g1" })],
  });
  close(gymOf(i, "g1").value, 1000);
});

test("value: other bill lines (not plans) are earned on the bill date", () => {
  // bill 1500 = gym 1000 + a 500 shop item; no discount.
  const i = input({
    gymPlans: [gym({ id: "g1" })],
    bills: [
      bill({
        id: "b-g1",
        subtotal: 1500,
        membershipId: "g1",
        membershipGross: 1000,
        invoiceDate: "2026-09-01",
      }),
    ],
  });
  const book = buildPlanBook(i);
  close(book.gym[0]!.value, 1000);
  assert.equal(book.otherLines.length, 1);
  close(book.otherLines[0]!.amount, 500);
});

test("value: plan with no bill at all counts as 0 and is noted", () => {
  const i = input({ gymPlans: [gym({ id: "g1", invoiceId: "gone" })] });
  const book = buildPlanBook(i);
  assert.equal(book.gym[0]!.value, 0);
  assert.equal(book.gym[0]!.paid, 0);
  assert.ok(book.notes.some((n) => /no bill/i.test(n)));
});

test("value: bill found through its membershipId when the plan has no invoiceId", () => {
  const i = input({
    gymPlans: [gym({ id: "g1", invoiceId: null })],
    bills: [bill({ id: "zz", subtotal: 700, membershipId: "g1", membershipGross: 700 })],
  });
  close(gymOf(i, "g1").value, 700);
});

test("value: old-software gym + PT on one bill: value = list price, paid = list - share of the open amount", () => {
  // bill 1500 (gym 1000 + PT 500), paid 1050, balance 450 -> open 450 shared 1000:500 = 300 / 150.
  const i = input({
    gymPlans: [gym({ id: "g1", invoiceId: "ob", listPrice: 1000, paidInOldSoftware: true })],
    ptPlans: [pt({ id: "p1", invoiceId: "ob", listPrice: 500, paidInOldSoftware: true })],
    bills: [
      bill({
        id: "ob",
        subtotal: 1500,
        amountPaid: 1050,
        membershipId: "g1",
        ptAssignmentId: "p1",
      }),
    ],
  });
  const g = gymOf(i, "g1");
  const p = ptOf(i, "p1");
  close(g.value, 1000);
  close(p.value, 500);
  close(g.paid, 700);
  close(p.paid, 350);
});

test("value: old-software bill counts a written-off (closed) balance as unpaid too", () => {
  // list 1000, paid 600, balance 0 but closedAmount 400 -> open 400 -> paid 600.
  const i = input({
    gymPlans: [gym({ id: "g1", invoiceId: "ob", listPrice: 1000, paidInOldSoftware: true })],
    bills: [
      bill({ id: "ob", subtotal: 1000, amountPaid: 600, closedAmount: 400, membershipId: "g1" }),
    ],
  });
  i.bills[0]!.balanceDue = 0;
  close(gymOf(i, "g1").paid, 600);
});

test("value: old-software balance bill brought to ₹0 (balance found paid there): value = paid = list", () => {
  const i = input({
    gymPlans: [gym({ id: "g1", invoiceId: "ob", listPrice: 900, paidInOldSoftware: true })],
    bills: [bill({ id: "ob", subtotal: 0, amountPaid: 0, membershipId: "g1" })],
  });
  i.bills[0]!.total = 0;
  i.bills[0]!.balanceDue = 0;
  close(gymOf(i, "g1").value, 900);
  close(gymOf(i, "g1").paid, 900);
});

test("value: old-software plan with no bill, and imported plan with no bill: value = paid = list", () => {
  const i = input({
    gymPlans: [
      gym({ id: "g1", invoiceId: null, listPrice: 900, paidInOldSoftware: true }),
      gym({ id: "g2", invoiceId: null, listPrice: 600, imported: true }),
    ],
  });
  const g1 = gymOf(i, "g1");
  const g2 = gymOf(i, "g2");
  close(g1.value, 900);
  close(g1.paid, 900);
  close(g2.value, 600);
  close(g2.paid, 600);
});

test("value: orphan bill (plan deleted) is earned on the bill date, trainer share taken off", () => {
  // bill 1000 = gym 800 + PT 200, plans gone. PT trainer line 80 -> gym 800, PT 200, trainer 80.
  const i = input({
    bills: [
      bill({
        id: "ob",
        subtotal: 1000,
        membershipId: "gone-g",
        ptAssignmentId: "gone-p",
        membershipGross: 800,
        ptGross: 200,
        invoiceDate: "2026-09-05",
      }),
    ],
    payouts: [payout({ id: "po1", ptAssignmentId: "gone-p", trainerShareAmount: 80 })],
  });
  const book = buildPlanBook(i);
  assert.equal(book.orphans.length, 1);
  const o = book.orphans[0]!;
  close(o.gym, 800);
  close(o.pt, 200);
  close(o.trainerShare, 80);
  assert.equal(o.date, "2026-09-05");
  assert.ok(book.notes.some((n) => /no longer exist/i.test(n)));
});

/* ----------------------------------------------- cancel, refund, upgrade, superseded */

const cancelInput = (refund: number): CfoInput =>
  input({
    gymPlans: [gym({ id: "g1", status: "cancelled", cancelledOn: "2026-09-07", cancelId: "c1x" })],
    bills: [bill({ id: "b-g1", subtotal: 1200, membershipId: "g1", membershipGross: 1200 })],
    payments: refund
      ? [payment({ id: "r1", amount: -refund, kind: "refund", cancelId: "c1x" })]
      : [],
  });

test("cancel with no refund: gym keeps everything paid (6 days earned, rest booked on the cancel day)", () => {
  const e = gymOf(cancelInput(0), "g1");
  close(lifetimeOf(e.spread), 1200);
  close(earnedInRange(e.spread, "2026-09-01", "2026-09-06"), 600);
  close(earnedInRange(e.spread, "2026-09-07", "2026-09-07"), 600);
});

test("cancel with part refund 400: lifetime = 1200 - 400 = 800", () => {
  const e = gymOf(cancelInput(400), "g1");
  close(lifetimeOf(e.spread), 800);
  close(earnedInRange(e.spread, "2026-09-07", "2026-09-07"), 200); // 800 - 600
});

test("cancel with full refund: lifetime 0 and the cancel day takes the earned part back", () => {
  const e = gymOf(cancelInput(1200), "g1");
  close(lifetimeOf(e.spread), 0);
  close(earnedInRange(e.spread, "2026-09-07", "2026-09-07"), -600);
});

test("cancel: refund shared by paid amount between the gym and PT plan of one cancel", () => {
  // gym paid 600, PT paid 300, refund 450 -> gym 300 back, PT 150 back.
  const i = input({
    gymPlans: [
      gym({
        id: "g1",
        invoiceId: "bb",
        status: "cancelled",
        cancelledOn: "2026-09-07",
        cancelId: "cx",
      }),
    ],
    ptPlans: [
      pt({
        id: "p1",
        invoiceId: "bb",
        status: "cancelled",
        cancelledOn: "2026-09-07",
        cancelId: "cx",
      }),
    ],
    bills: [
      bill({
        id: "bb",
        subtotal: 1500,
        discount: 150,
        amountPaid: 900,
        membershipId: "g1",
        ptAssignmentId: "p1",
        membershipGross: 1000,
        ptGross: 500,
      }),
    ],
    payments: [payment({ id: "r", amount: -450, kind: "refund", cancelId: "cx" })],
  });
  close(lifetimeOf(gymOf(i, "g1").spread), 300); // 600 - 300
  close(lifetimeOf(ptOf(i, "p1").spread), 150); // 300 - 150
});

test("cancelled PT: trainer share follows the lowered payout, gym keeps the rest", () => {
  // PT Rs 1000 over 10 days, cancelled on the 5th with Rs 500 refund -> income 500.
  // Trainer line was 300, lowered to 150 by the cancel -> trainer cost 150. Gym share 350.
  const i = input({
    ptPlans: [pt({ id: "p1", status: "cancelled", cancelledOn: "2026-09-05", cancelId: "cx" })],
    bills: [bill({ id: "b-p1", subtotal: 1000, ptAssignmentId: "p1", ptGross: 1000 })],
    payments: [payment({ id: "r", amount: -500, kind: "refund", cancelId: "cx" })],
    payouts: [
      payout({ id: "po", ptAssignmentId: "p1", trainerShareAmount: 150, originalShare: 300 }),
    ],
  });
  const p = ptOf(i, "p1");
  close(lifetimeOf(p.spread), 500);
  close(lifetimeOf(p.share), 150);
  close(
    earnedInRange(p.spread, "2026-09-01", "2026-09-30") -
      earnedInRange(p.share, "2026-09-01", "2026-09-30"),
    350,
  );
  // before the cancel day: income 4 days x 100 = 400, trainer 4 x 30 = 120
  close(earnedInRange(p.spread, "2026-09-01", "2026-09-04"), 400);
  close(earnedInRange(p.share, "2026-09-01", "2026-09-04"), 120);
});

test("trainer share: adjustment (minus) lines and cancelled lines are handled", () => {
  // lines: +300 original, -60 adjustment, one cancelled line 100 (ignored for the final).
  const i = input({
    ptPlans: [pt({ id: "p1", status: "cancelled", cancelledOn: "2026-09-05", cancelId: "cx" })],
    bills: [bill({ id: "b-p1", subtotal: 1000, ptAssignmentId: "p1", ptGross: 1000 })],
    payouts: [
      payout({ id: "a", ptAssignmentId: "p1", trainerShareAmount: 300 }),
      payout({ id: "b", ptAssignmentId: "p1", trainerShareAmount: -60, adjustment: true }),
      payout({ id: "c", ptAssignmentId: "p1", trainerShareAmount: 100, status: "cancelled" }),
    ],
  });
  const p = ptOf(i, "p1");
  close(lifetimeOf(p.share), 240); // 300 - 60
});

test("trainer share without payout lines: plan snapshot only when the bill is live and not old-software", () => {
  const live = input({
    ptPlans: [pt({ id: "p1", trainerShareAmount: 250 })],
    bills: [bill({ id: "b-p1", subtotal: 1000, ptAssignmentId: "p1", ptGross: 1000 })],
  });
  close(lifetimeOf(ptOf(live, "p1").share), 250);
  const noBill = input({ ptPlans: [pt({ id: "p1", trainerShareAmount: 250, invoiceId: "zz" })] });
  close(lifetimeOf(ptOf(noBill, "p1").share), 0);
  const old = input({
    ptPlans: [pt({ id: "p1", trainerShareAmount: 250, paidInOldSoftware: true })],
    bills: [bill({ id: "b-p1", subtotal: 1000, ptAssignmentId: "p1" })],
  });
  close(lifetimeOf(ptOf(old, "p1").share), 0);
});

/** An old yearly plan (365 days, Rs 3650) upgraded to a new yearly plan (Rs 5000). */
function upgradeInput(upgradeDay: string, credit: number): CfoInput {
  const oldEnd = new Date(Date.parse(`${upgradeDay}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return input({
    gymPlans: [
      gym({
        id: "old",
        startDate: "2026-01-01",
        endDate: oldEnd,
        originalEndDate: "2026-12-31",
        upgradeCredit: credit,
        upgradedTo: "new",
        upgradeFrom: upgradeDay,
        listPrice: 3650,
        status: "expired",
      }),
      gym({
        id: "new",
        startDate: upgradeDay,
        endDate: "2027-12-31",
        listPrice: 5000,
      }),
    ],
    bills: [
      bill({ id: "b-old", subtotal: 3650, membershipId: "old", membershipGross: 3650 }),
      bill({
        id: "b-new",
        subtotal: 5000,
        discount: credit,
        amountPaid: 5000 - credit,
        upgradeCredit: credit,
        membershipId: "new",
        membershipGross: 5000,
      }),
    ],
  });
}

test("upgrade after 165 days: old + new lifetime earned = cash kept (3650 + 3000 = 6650)", () => {
  // 2026-06-15 is day 166. 200 unused days of Rs 10 = Rs 2000 credit.
  const i = upgradeInput("2026-06-15", 2000);
  const o = gymOf(i, "old");
  const n = gymOf(i, "new");
  close(lifetimeOf(o.spread), 1650); // 3650 - 2000
  close(lifetimeOf(n.spread), 5000);
  close(n.paid, 5000); // 3000 cash + 2000 credit
  close(lifetimeOf(o.spread) + lifetimeOf(n.spread), 3650 + 3000);
  // old plan: 165 days x Rs 10 = 1650 by the 14th, nothing booked on the cut day.
  close(earnedInRange(o.spread, "2026-01-01", "2026-06-14"), 1650);
  close(earnedInRange(o.spread, "2026-06-15", "2026-12-31"), 0);
});

test("upgrade on day 1: old plan earns nothing, new plan keeps all cash (0 + 5000 = 3650 + 1350)", () => {
  const i = upgradeInput("2026-01-01", 3650);
  const o = gymOf(i, "old");
  const n = gymOf(i, "new");
  close(lifetimeOf(o.spread), 0);
  close(lifetimeOf(o.spread) + lifetimeOf(n.spread), 3650 + 1350);
});

test("upgrade future-dated: the same lifetime, nothing booked at the cut before it happens", () => {
  const i = upgradeInput("2026-11-16", 450);
  const o = gymOf(i, "old");
  const n = gymOf(i, "new");
  close(lifetimeOf(o.spread) + lifetimeOf(n.spread), 3650 + (5000 - 450));
  // up to today (6 Oct) the old plan has earned 279 days x 10 = 2790 and nothing extra
  close(earnedInRange(o.spread, "2026-01-01", "2026-10-06"), 2790);
});

test("upgrade of a discounted plan: the credit above what was paid is a loss on the upgrade day", () => {
  // Old: list 12000, staff discount 3000, paid 9000, from 1 Jan (original end 1 Jan 2027).
  // Upgraded from 31 Jan with the wizard's list-price credit 12000 x 335/365 = 11014.
  // New: list 20000, bill discount = credit, member pays 8986. Cash kept 9000 + 8986 = 17986.
  const credit = Math.round((12000 * 335) / 365);
  const i = input({
    gymPlans: [
      gym({
        id: "old",
        startDate: "2026-01-01",
        endDate: "2026-01-30",
        originalEndDate: "2027-01-01",
        listPrice: 12000,
        status: "expired",
        upgradedTo: "new",
        upgradeFrom: "2026-01-31",
        upgradeCredit: credit,
        invoiceId: "b-old",
      }),
      gym({
        id: "new",
        startDate: "2026-01-31",
        endDate: "2027-01-31",
        listPrice: 20000,
        invoiceId: "b-new",
      }),
    ],
    bills: [
      bill({
        id: "b-old",
        subtotal: 12000,
        discount: 3000,
        amountPaid: 9000,
        membershipId: "old",
        membershipGross: 12000,
        invoiceDate: "2026-01-01",
      }),
      bill({
        id: "b-new",
        subtotal: 20000,
        discount: credit,
        upgradeCredit: credit,
        membershipId: "new",
        membershipGross: 20000,
        invoiceDate: "2026-01-31",
      }),
    ],
  });
  const o = gymOf(i, "old");
  const n = gymOf(i, "new");
  close(lifetimeOf(o.spread) + lifetimeOf(n.spread), 9000 + (20000 - credit));
  close(lifetimeOf(o.spread), 9000 - credit); // minus: the credit was more than the member paid
});

test("downgrade: credit above the new price is capped by the bill, lifetime = cash kept", () => {
  // Old 12000 paid in full; 'upgraded' after 30 days to a 5000 plan. The bill caps the
  // discount at 5000 (total 0) while the plan doc keeps the wizard's 11014.
  const i = input({
    gymPlans: [
      gym({
        id: "old",
        startDate: "2026-01-01",
        endDate: "2026-01-30",
        originalEndDate: "2027-01-01",
        listPrice: 12000,
        status: "expired",
        upgradedTo: "new",
        upgradeFrom: "2026-01-31",
        upgradeCredit: 11014,
        invoiceId: "b-old",
      }),
      gym({
        id: "new",
        startDate: "2026-01-31",
        endDate: "2026-03-01",
        listPrice: 5000,
        invoiceId: "b-new",
      }),
    ],
    bills: [
      bill({
        id: "b-old",
        subtotal: 12000,
        amountPaid: 12000,
        membershipId: "old",
        membershipGross: 12000,
        invoiceDate: "2026-01-01",
      }),
      bill({
        id: "b-new",
        subtotal: 5000,
        discount: 5000,
        upgradeCredit: 11014,
        amountPaid: 0,
        membershipId: "new",
        membershipGross: 5000,
        invoiceDate: "2026-01-31",
      }),
    ],
  });
  close(lifetimeOf(gymOf(i, "old").spread) + lifetimeOf(gymOf(i, "new").spread), 12000);
});

test("superseded plan: gym keeps the full value, the cut day books the rest", () => {
  // g1 expired 1st-12th (Rs 1200), g2 starts on the 7th -> 6 days x 100, then 600 on the 7th.
  const i = input({
    gymPlans: [
      gym({ id: "g1", status: "expired" }),
      gym({ id: "g2", startDate: "2026-09-07", endDate: "2026-10-06" }),
    ],
    bills: [
      bill({ id: "b-g1", subtotal: 1200, membershipId: "g1", membershipGross: 1200 }),
      bill({ id: "b-g2", subtotal: 3000, membershipId: "g2", membershipGross: 3000 }),
    ],
  });
  const e = gymOf(i, "g1");
  assert.equal(e.superseded, true);
  close(lifetimeOf(e.spread), 1200);
  close(earnedInRange(e.spread, "2026-09-01", "2026-09-06"), 600);
  close(earnedInRange(e.spread, "2026-09-07", "2026-09-07"), 600);
  assert.equal(gymOf(i, "g2").superseded, false);
});

test("a renewal that starts the day after the end is not a supersede", () => {
  const i = input({
    gymPlans: [
      gym({ id: "g1", status: "expired" }),
      gym({ id: "g2", startDate: "2026-09-13", endDate: "2026-10-12" }),
    ],
    bills: [bill({ id: "b-g1", subtotal: 1200 }), bill({ id: "b-g2", subtotal: 3000 })],
  });
  assert.equal(gymOf(i, "g1").superseded, false);
});

test("plan with missing end date: all value on the start day plus a note", () => {
  const i = input({
    gymPlans: [gym({ id: "g1", endDate: "" })],
    bills: [bill({ id: "b-g1", subtotal: 1200, membershipId: "g1" })],
    plansMissingEndDate: 2,
  });
  const book = buildPlanBook(i);
  close(earnedInRange(book.gym[0]!.spread, "2026-09-01", "2026-09-01"), 1200);
  assert.ok(book.notes.some((n) => /end date/i.test(n)));
});

test("every plan value and paid is finite even with bad numbers in the data", () => {
  const i = input({
    gymPlans: [gym({ id: "g1", listPrice: Number.NaN })],
    bills: [
      bill({
        id: "b-g1",
        subtotal: Number.NaN,
        discount: Infinity,
        total: Number.NaN,
        amountPaid: Number.NaN,
      }),
    ],
  });
  const e = gymOf(i, "g1");
  assert.ok(Number.isFinite(e.value) && Number.isFinite(e.paid));
});
