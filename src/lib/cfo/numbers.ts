/**
 * Layer 1: the numbers (CFO_PLAN.md 4.3). Pure maths over `CfoInput`.
 *
 * Rounding rule: every leaf (a month's gym / PT / other income, each expense category, each cash
 * part, each advance item) is rounded once to whole rupees. Every total and difference is built
 * from the rounded leaves, so profit = earned - expenses and free cash = cash - parts add up
 * exactly on the page.
 */
import { buildListDoc, computeAlerts, sortByMoney, summarize } from "./alerts.ts";
import { daysInMonth, monthEnd, monthKey, monthLabel, reportWindow, toDay } from "./dates.ts";
import { formatMonths, roundRupee } from "./money.ts";
import {
  buildPlanBook,
  countsAsNew,
  earnedBetween,
  fin,
  groupByClient,
  lifetimeOf,
} from "./plans.ts";
import type { GymEntry, PtEntry } from "./plans.ts";
import type {
  CfoAlertRow,
  CfoCash,
  CfoComputed,
  CfoDueGroup,
  CfoDueRow,
  CfoDues,
  CfoInput,
  CfoMonth,
  CfoSettings,
  CfoSnapshot,
  CfoTone,
  CfoTrainerRow,
} from "./types.ts";

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

type Range = [number, number];

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function overlap(ranges: Range[], a: number, b: number): number {
  let n = 0;
  for (const [x, y] of ranges) {
    const lo = Math.max(x, a);
    const hi = Math.min(y, b);
    if (hi >= lo) n += hi - lo + 1;
  }
  return n;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function computeCfo(
  input: CfoInput,
  settings: CfoSettings,
  meta: { computedAt: string; computedBy: string },
): CfoComputed {
  const win = reportWindow(input.today);
  const today = toDay(input.today) ?? 0;
  const grace = Math.max(0, Math.round(fin(settings.graceDays)));
  const book = buildPlanBook(input);
  const gymBy = groupByClient(book.gym);
  const ptBy = groupByClient(book.pt);
  const membersById = new Map(input.members.map((m) => [m.id, m] as const));

  const thisKey = monthKey(input.today);
  const lastKey = win.months[5]?.key ?? thisKey;
  const firstExpenseKey = input.firstExpenseDate ? monthKey(input.firstExpenseDate) : null;

  /* ---- who is covered on which days (paused members still count) */
  const coverage = new Map<string, Range[]>();
  const cover = (clientId: string, a: number | null, b: number | null) => {
    if (a === null || b === null || b < a) return;
    const l = coverage.get(clientId);
    if (l) l.push([a, b]);
    else coverage.set(clientId, [[a, b]]);
  };
  for (const e of book.gym) if (!e.cancelled) cover(e.clientId, e.startDay, e.effEndDay);
  for (const e of book.pt) if (!e.cancelled) cover(e.clientId, e.startDay, e.effEndDay);
  for (const [k, v] of coverage) coverage.set(k, mergeRanges(v));

  /* ---- months */
  const otherIncomeDays = book.otherLines.map((l) => ({
    day: toDay(l.date),
    amount: fin(l.amount),
  }));
  const orphans = book.orphans.map((o) => ({ ...o, day: toDay(o.date) }));
  const manual = input.otherIncome.map((x) => ({ day: toDay(x.date), amount: fin(x.amount) }));
  const payments = input.payments.map((p) => ({
    day: toDay(p.paymentDate),
    amount: fin(p.amount),
  }));
  const oldBills = input.bills
    .filter((b) => b.paymentsTracked === false)
    .map((b) => ({ day: toDay(b.invoiceDate), amount: fin(b.amountPaid) }));
  const expenses = input.expenses.map((x) => ({
    day: toDay(x.date),
    amount: fin(x.amount),
    category: x.category.trim() || "Other",
    paidByGym: x.paidByGym,
    settled: x.settled,
    settledDay: toDay(x.settledDate),
  }));

  const inRange = <T extends { day: number | null }>(list: T[], a: number, b: number) =>
    list.filter((x) => x.day !== null && x.day >= a && x.day <= b);

  const eligibleRenewal = book.gym.filter(
    (e) => !e.cancelled && !e.plan.upgradedTo && !e.superseded && e.endDay !== null,
  );
  const cancelledGym = book.gym.filter((e) => e.cancelled && toDay(e.plan.cancelledOn) !== null);
  const newByMonth = new Map<string, number>();
  for (const m of input.members) {
    if (!m.joinedOn || !countsAsNew(gymBy.get(m.id) ?? [], ptBy.get(m.id) ?? [])) continue;
    const k = monthKey(m.joinedOn);
    newByMonth.set(k, (newByMonth.get(k) ?? 0) + 1);
  }

  const avgRaw: number[] = [];
  const months: CfoMonth[] = win.months.map((w) => {
    const a = toDay(w.from) as number;
    const b = toDay(w.to) as number;
    const partial = w.key === thisKey;
    const daysCounted = b - a + 1;
    const dim = daysInMonth(w.key);

    let gymSum = 0;
    for (const e of book.gym) gymSum += earnedBetween(e.spread, a, b);
    let ptSum = 0;
    for (const e of book.pt) ptSum += earnedBetween(e.spread, a, b);
    let shareSum = 0;
    for (const e of book.pt) shareSum += earnedBetween(e.share, a, b);
    for (const o of inRange(orphans, a, b)) {
      gymSum += o.gym;
      ptSum += o.pt;
      shareSum += o.trainerShare;
    }
    const otherSum =
      sum(inRange(otherIncomeDays, a, b).map((x) => x.amount)) +
      sum(inRange(manual, a, b).map((x) => x.amount));

    const gymLeaf = roundRupee(gymSum);
    const ptIncome = roundRupee(ptSum);
    const trainerShare = roundRupee(shareSum);
    const ptLeaf = ptIncome - trainerShare;
    const otherLeaf = roundRupee(otherSum);
    const earnedTotal = gymLeaf + ptLeaf + otherLeaf;

    const cats = new Map<string, number>();
    for (const x of inRange(expenses, a, b))
      cats.set(x.category, (cats.get(x.category) ?? 0) + x.amount);
    const byCategory: Record<string, number> = {};
    let expTotal = 0;
    for (const [k, v] of [...cats].sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0))) {
      const r = roundRupee(v);
      byCategory[k] = r;
      expTotal += r;
    }

    const received = roundRupee(
      sum(inRange(payments, a, b).map((x) => x.amount)) +
        sum(inRange(oldBills, a, b).map((x) => x.amount)),
    );

    // Members covered on at least one day / member-days.
    let memberDays = 0;
    let active = 0;
    for (const ranges of coverage.values()) {
      const n = overlap(ranges, a, b);
      if (n > 0) {
        active += 1;
        memberDays += n;
      }
    }
    const avg = daysCounted > 0 ? memberDays / daysCounted : 0;
    avgRaw.push(avg);

    // Renewals: latest plan of each member that ends in this month.
    const latest = new Map<string, GymEntry>();
    const monthLast = toDay(monthEnd(w.key)) as number;
    for (const e of eligibleRenewal) {
      const end = e.endDay as number;
      if (end < a || end > monthLast) continue;
      const cur = latest.get(e.clientId);
      if (!cur || end > (cur.endDay as number)) latest.set(e.clientId, e);
    }
    let renewed = 0;
    let notRenewed = 0;
    let deciding = 0;
    const lost = new Set<string>();
    for (const e of latest.values()) {
      const end = e.endDay as number;
      // A renewal is a later plan that really runs on: not one cut short by another plan
      // (superseded / upgraded) and not one that started before this plan.
      const again = (gymBy.get(e.clientId) ?? []).some(
        (o) =>
          o !== e &&
          !o.cancelled &&
          !o.superseded &&
          !o.upgraded &&
          o.startDay !== null &&
          e.startDay !== null &&
          o.startDay > e.startDay &&
          o.endDay !== null &&
          o.endDay > end &&
          o.startDay !== null &&
          o.startDay <= end + grace,
      );
      if (again) renewed += 1;
      else if (end + grace < today) {
        notRenewed += 1;
        lost.add(e.clientId);
      } else deciding += 1;
    }

    // Left early: a plan cancelled this month and nothing covering the cancel day or following soon.
    const left = new Set<string>();
    for (const e of cancelledGym) {
      const c = toDay(e.plan.cancelledOn) as number;
      if (monthKey(e.plan.cancelledOn as string) !== w.key || lost.has(e.clientId)) continue;
      const kept = (gymBy.get(e.clientId) ?? []).some(
        (o) =>
          o !== e &&
          !o.cancelled &&
          o.endDay !== null &&
          o.endDay >= c &&
          o.startDay !== null &&
          o.startDay <= c + grace,
      );
      if (!kept) left.add(e.clientId);
    }

    const newMembers = newByMonth.get(w.key) ?? 0;
    const hasData = firstExpenseKey !== null && w.key >= firstExpenseKey;
    return {
      key: w.key,
      label: monthLabel(w.key),
      from: w.from,
      to: w.to,
      partial,
      daysCounted,
      daysInMonth: dim,
      hasData,
      earned: { gym: gymLeaf, pt: ptLeaf, other: otherLeaf, total: earnedTotal },
      ptIncome,
      trainerShare,
      received,
      expenses: { byCategory, total: expTotal },
      profit: earnedTotal - expTotal,
      activeMembers: active,
      avgActiveMembers: round2(avg),
      newMembers,
      plansEnded: renewed + notRenewed + deciding,
      renewed,
      notRenewed,
      stillDeciding: deciding,
      leftEarly: left.size,
      renewalRate: renewed + notRenewed > 0 ? renewed / (renewed + notRenewed) : null,
      netGrowth: newMembers - notRenewed - left.size,
    };
  });

  const lastMonth = months[5] as CfoMonth;
  const thisMonth = months[6] as CfoMonth;

  /* ---- averages, income per member, break-even */
  const fullWithData = months.slice(0, 6).filter((m) => m.hasData);
  const used = fullWithData.slice(-3);
  const avgMonthlyExpenses =
    used.length > 0 ? roundRupee(sum(used.map((m) => m.expenses.total)) / used.length) : null;
  const lastAvg = avgRaw[5] ?? 0;
  const ipmRaw =
    lastMonth.hasData && lastAvg > 0 ? roundRupee(lastMonth.earned.total / lastAvg) : 0;
  const incomePerMember = ipmRaw > 0 ? ipmRaw : null;
  const breakEvenMembers =
    avgMonthlyExpenses !== null && incomePerMember !== null
      ? Math.ceil(avgMonthlyExpenses / incomePerMember)
      : null;

  /* ---- active today */
  let activeMembers = 0;
  for (const ranges of coverage.values()) if (overlap(ranges, today, today) > 0) activeMembers += 1;
  const aboveBreakEven = breakEvenMembers === null ? null : activeMembers >= breakEvenMembers;

  /* ---- advance: paid in advance by members */
  let advanceOwed = 0;
  let trainerShareInAdvance = 0;
  const advance = (e: GymEntry | PtEntry) => {
    if (e.cancelled || e.startDay === null || e.effEndDay === null || e.effEndDay < today) return;
    const used = earnedBetween(e.plain, e.startDay, today);
    const owed = roundRupee(Math.max(0, e.paidEff - used));
    advanceOwed += owed;
    if ("share" in e) {
      // The trainer's part of the unused PT days is owed once: to the trainer, or back to the
      // member on a refund (the app then takes it off the trainer's pay).
      const unusedShare = Math.max(
        0,
        lifetimeOf(e.share) - earnedBetween(e.share, e.startDay, today),
      );
      trainerShareInAdvance += owed - roundRupee(Math.max(0, e.paidEff - used - unusedShare));
    }
  };
  for (const e of book.gym) advance(e);
  for (const e of book.pt) advance(e);

  /* ---- cash */
  const opening = toDay(settings.openingDate);
  const cashSet = settings.openingBalance !== null && opening !== null;
  const pendingTrainer = roundRupee(
    sum(input.payouts.filter((p) => p.status === "pending").map((p) => fin(p.trainerShareAmount))),
  );
  const unsettledStaffPaid = roundRupee(
    sum(expenses.filter((x) => !x.paidByGym && !x.settled).map((x) => x.amount)),
  );
  let cash: CfoCash;
  if (cashSet) {
    const d = opening as number;
    const pay = roundRupee(
      sum(payments.filter((p) => p.day !== null && p.day >= d).map((p) => p.amount)),
    );
    const old = roundRupee(
      sum(oldBills.filter((p) => p.day !== null && p.day >= d).map((p) => p.amount)),
    );
    const oth = roundRupee(
      sum(manual.filter((p) => p.day !== null && p.day >= d).map((p) => p.amount)),
    );
    const exp = roundRupee(
      sum(
        expenses
          .filter((x) =>
            x.paidByGym
              ? x.day !== null && x.day >= d
              : x.settled && x.settledDay !== null && x.settledDay >= d,
          )
          .map((x) => x.amount),
      ),
    );
    const trainerPaid = roundRupee(
      sum(
        input.payouts
          .filter((p) => {
            const paidAt = toDay(p.paidAt);
            return p.status === "paid" && paidAt !== null && paidAt >= d;
          })
          .map((p) => fin(p.trainerShareAmount)),
      ),
    );
    const openingBalance = roundRupee(fin(settings.openingBalance));
    const balance = openingBalance + pay + old + oth - exp - trainerPaid;
    const runway =
      avgMonthlyExpenses === null || avgMonthlyExpenses <= 0
        ? null
        : balance <= 0
          ? 0
          : round2(balance / avgMonthlyExpenses);
    cash = {
      set: true,
      openingBalance,
      openingDate: settings.openingDate,
      balance,
      freeCash: balance - advanceOwed + trainerShareInAdvance - pendingTrainer - unsettledStaffPaid,
      runwayMonths: runway,
      parts: {
        payments: pay,
        oldBills: old,
        otherIncome: oth,
        expensesPaid: exp,
        trainerPaid,
        pendingTrainer,
        trainerShareInAdvance,
        unsettledStaffPaid,
      },
    };
  } else {
    cash = {
      set: false,
      openingBalance: null,
      openingDate: "",
      balance: null,
      freeCash: null,
      runwayMonths: null,
      parts: {
        payments: 0,
        oldBills: 0,
        otherIncome: 0,
        expensesPaid: 0,
        trainerPaid: 0,
        pendingTrainer: 0,
        trainerShareInAdvance: 0,
        unsettledStaffPaid: 0,
      },
    };
  }

  /* ---- pending dues */
  const dueRows: CfoDueRow[] = [];
  const groups: CfoDues["groups"] = {
    notDue: { count: 0, amount: 0 },
    d0_7: { count: 0, amount: 0 },
    d8_30: { count: 0, amount: 0 },
    d30plus: { count: 0, amount: 0 },
  };
  for (const b of input.bills) {
    if (b.status === "refunded" || b.status === "closed") continue;
    const balance = roundRupee(fin(b.balanceDue));
    if (balance <= 0) continue;
    const ref = toDay(b.dueDate) ?? toDay(b.invoiceDate) ?? today;
    const late = today - ref;
    const group: CfoDueGroup =
      late < 0 ? "notDue" : late <= 7 ? "d0_7" : late <= 30 ? "d8_30" : "d30plus";
    const m = membersById.get(b.clientId);
    dueRows.push({
      billId: b.id,
      billNumber: b.number,
      clientId: b.clientId,
      name: m?.name ?? b.clientName,
      phone: m?.phone ?? b.clientPhone,
      code: m?.code ?? "",
      items: b.itemNames.join(", "),
      balance,
      dueDate: b.dueDate,
      daysLate: late,
      group,
    });
    groups[group].count += 1;
    groups[group].amount += balance;
  }
  sortByMoney(
    dueRows,
    (r) => r.balance,
    (r) => r.name,
  );
  const dues: CfoDues = {
    count: dueRows.length,
    total: sum(dueRows.map((r) => r.balance)),
    groups,
  };

  /* ---- PT per trainer */
  const trainerIds = new Set(input.trainers.map((t) => t.id));
  const trainerRows: CfoTrainerRow[] = [];
  const monthFigures = (trainerId: string, m: CfoMonth) => {
    const a = toDay(m.from) as number;
    const b = toDay(m.to) as number;
    let inc = 0;
    let share = 0;
    for (const e of book.pt) {
      if (e.trainerId !== trainerId) continue;
      inc += earnedBetween(e.spread, a, b);
      share += earnedBetween(e.share, a, b);
    }
    const income = roundRupee(inc);
    const trainerShare = roundRupee(share);
    return { income, trainerShare, gymKeeps: income - trainerShare };
  };
  const addTrainer = (id: string, name: string, salary: number | null, always: boolean) => {
    const row: CfoTrainerRow = {
      trainerId: id,
      name,
      thisMonth: monthFigures(id, thisMonth),
      lastMonth: monthFigures(id, lastMonth),
      monthlySalary: salary,
    };
    const any =
      row.thisMonth.income !== 0 ||
      row.lastMonth.income !== 0 ||
      row.thisMonth.trainerShare !== 0 ||
      row.lastMonth.trainerShare !== 0;
    if (always || any) trainerRows.push(row);
  };
  for (const t of input.trainers) addTrainer(t.id, t.name, t.monthlySalary, true);
  for (const e of book.pt) {
    if (!trainerIds.has(e.trainerId)) {
      trainerIds.add(e.trainerId);
      addTrainer(e.trainerId, e.plan.trainerName, null, false);
    }
  }
  trainerRows.sort(
    (p, q) =>
      q.thisMonth.income - p.thisMonth.income ||
      q.lastMonth.income - p.lastMonth.income ||
      (p.name < q.name ? -1 : p.name > q.name ? 1 : 0),
  );

  /* ---- Layer 2 lists */
  const alerts = computeAlerts(input, settings, book);
  const total = (rows: CfoAlertRow[]) => sum(rows.map((r) => r.money));
  const totals = {
    atRisk: total(alerts.atRisk),
    renewals: total(alerts.renewals),
    newSlipping: total(alerts.newSlipping),
    ptChances: total(alerts.ptChances),
  };

  /* ---- cash warning and health */
  const reasons: string[] = [];
  if (cash.set && cash.balance !== null) {
    if (cash.balance <= 0) {
      reasons.push("All the gym's money has run out.");
    } else if (cash.runwayMonths !== null && cash.runwayMonths < settings.runwayWarnMonths) {
      reasons.push(
        `Money lasts ${formatMonths(cash.runwayMonths)} if no new money comes in (warning below ${settings.runwayWarnMonths} months).`,
      );
    }
  }
  if (breakEvenMembers !== null && activeMembers < breakEvenMembers) {
    reasons.push(
      `Active members (${activeMembers}) are below the break-even number (${breakEvenMembers}).`,
    );
  }

  const tone = (cond: boolean | null, good: CfoTone, other: CfoTone): CfoTone =>
    cond === null ? "none" : cond ? good : other;
  let profitTone: CfoTone = "none";
  if (lastMonth.hasData)
    profitTone = lastMonth.profit > 0 ? "good" : lastMonth.profit < 0 ? "bad" : "warn";
  let breakEvenTone: CfoTone = "none";
  if (breakEvenMembers !== null) {
    breakEvenTone =
      activeMembers < breakEvenMembers
        ? "bad"
        : activeMembers * 10 < breakEvenMembers * 11
          ? "warn"
          : "good";
  }
  const cashTone: CfoTone =
    cash.set && cash.balance !== null ? tone(cash.balance > 0, "good", "bad") : "none";
  let freeTone: CfoTone = "none";
  if (cash.set && cash.freeCash !== null) {
    freeTone =
      cash.freeCash < 0
        ? "bad"
        : avgMonthlyExpenses !== null && cash.freeCash < avgMonthlyExpenses
          ? "warn"
          : "good";
  }
  let runwayTone: CfoTone = "none";
  if (cash.runwayMonths !== null) {
    runwayTone =
      cash.runwayMonths < settings.runwayWarnMonths
        ? "bad"
        : cash.runwayMonths < settings.runwayWarnMonths * 2
          ? "warn"
          : "good";
  }

  /* ---- data notes (plain English, never names) */
  const dataNotes = [...book.notes];
  if (firstExpenseKey === null) {
    dataNotes.push("No expenses have been recorded yet, so profit cannot be worked out.");
  } else if (firstExpenseKey > (win.months[0]?.key ?? firstExpenseKey)) {
    dataNotes.push(
      `Expense records start in ${monthLabel(firstExpenseKey)}; earlier months show income only.`,
    );
  }
  if (used.length > 0 && used.length < 3) {
    dataNotes.push(
      `Average expenses are based on ${used.length} ${plural(used.length, "month", "months")} of records.`,
    );
  }
  if (alerts.notTracked > 0) {
    dataNotes.push(
      `${alerts.notTracked} ${plural(alerts.notTracked, "member", "members")} with a running plan cannot be checked for visits yet (no thumb registered and no visit so far).`,
    );
  }
  if (!cash.set) dataNotes.push("Opening money is not set, so the cash numbers are not shown.");

  const snapshot: CfoSnapshot = {
    version: 1,
    computedAt: meta.computedAt,
    computedBy: meta.computedBy,
    today: input.today,
    currency: "INR",
    months,
    thisMonthKey: thisKey,
    lastMonthKey: lastKey,
    avgMonthlyExpenses,
    avgBasedOnMonths: used.length,
    activeMembers,
    incomePerMember,
    breakEvenMembers,
    aboveBreakEven,
    advanceOwed,
    cash,
    dues,
    trainers: trainerRows,
    lists: {
      atRisk: summarize(alerts.atRisk, totals.atRisk),
      renewals: summarize(alerts.renewals, totals.renewals),
      newSlipping: summarize(alerts.newSlipping, totals.newSlipping),
      ptChances: summarize(alerts.ptChances, totals.ptChances),
      dues: summarize(dueRows, dues.total),
    },
    cashWarning: { on: reasons.length > 0, reasons },
    notTracked: alerts.notTracked,
    ptFromPrice: alerts.ptFromPrice,
    dataNotes,
    health: {
      profit: profitTone,
      breakEven: breakEvenTone,
      cash: cashTone,
      freeCash: freeTone,
      runway: runwayTone,
    },
  };

  const at = meta.computedAt;
  return {
    snapshot,
    lists: {
      atRisk: buildListDoc("atRisk", alerts.atRisk, totals.atRisk, at),
      renewals: buildListDoc("renewals", alerts.renewals, totals.renewals, at),
      newSlipping: buildListDoc("newSlipping", alerts.newSlipping, totals.newSlipping, at),
      ptChances: buildListDoc("ptChances", alerts.ptChances, totals.ptChances, at),
      dues: buildListDoc("dues", dueRows, dues.total, at),
    },
  };
}
