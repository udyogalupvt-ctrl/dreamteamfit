/**
 * The summary the app writes itself, from a fixed template, when there is no AI summary (AI not
 * connected, switched off, or it failed). Same three parts as the AI's, and every number comes
 * from the same pre-formatted brief input the AI gets, so it always matches the page.
 */
import { buildBriefInput } from "./brief.ts";
import { formatRupees } from "./money.ts";
import type { CfoSettings, CfoSnapshot } from "./types.ts";

interface Problem {
  /** Rupees at stake, to put the biggest first. */
  money: number;
  wrong: string;
  action: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function templateBrief(snapshot: CfoSnapshot, settings: CfoSettings): string {
  const b = buildBriefInput(snapshot, settings);
  const last = snapshot.months.find((m) => m.key === snapshot.lastMonthKey);
  const cash = snapshot.cash;
  const L = snapshot.lists;

  /* ---- Where you stand */
  const stand: string[] = [];
  if (last && last.hasData) {
    stand.push(
      last.profit >= 0
        ? `In ${b.lastFullMonth.month} the gym made a profit of ${b.lastFullMonth.profitOrLoss}: it earned ${b.lastFullMonth.earnedIncome} and spent ${b.lastFullMonth.expenses}.`
        : `In ${b.lastFullMonth.month} the gym made a loss of ${formatRupees(-last.profit)}: it earned ${b.lastFullMonth.earnedIncome} and spent ${b.lastFullMonth.expenses}.`,
    );
  } else {
    stand.push(
      `There are no expense records for ${b.lastFullMonth.month}, so profit or loss can't be worked out yet.`,
    );
  }
  if (snapshot.breakEvenMembers !== null) {
    stand.push(
      `${b.members.activeToday} ${plural(snapshot.activeMembers, "member is", "members are")} active today and ${b.members.breakEven} are needed to cover costs, so the gym is ${b.members.aboveOrBelow}.`,
    );
  } else {
    stand.push(
      `${b.members.activeToday} ${plural(snapshot.activeMembers, "member is", "members are")} active today. Break-even needs a full month of income and expense records.`,
    );
  }
  if (cash.set && cash.balance !== null) {
    stand.push(
      `All gym money is ${b.cash.allGymMoney}; ${b.cash.reallyYours} of it is really yours. It lasts ${b.cash.monthsOfRunway} if no new money comes in.`,
    );
  } else {
    stand.push("Add your opening money in CFO settings to see your cash and how long it lasts.");
  }

  /* ---- What is going wrong + Do this week, biggest money first */
  const problems: Problem[] = [];
  if (L.atRisk.count > 0)
    problems.push({
      money: L.atRisk.total,
      wrong: `${b.alerts.notComing.members} ${plural(L.atRisk.count, "member is", "members are")} not coming (no visit for ${b.rules.notComingDays} days, or coming much less). Their next renewals are worth ${b.alerts.notComing.money}.`,
      action: `Call the ${b.alerts.notComing.members} ${plural(L.atRisk.count, "member", "members")} who ${plural(L.atRisk.count, "is", "are")} not coming (renewals worth ${b.alerts.notComing.money}).`,
    });
  if (L.renewals.count > 0)
    problems.push({
      money: L.renewals.total,
      wrong: `${b.alerts.renewals.members} ${plural(L.renewals.count, "plan ends", "plans end")} in the next ${b.rules.renewalWindowDays} days and ${plural(L.renewals.count, "is", "are")} not renewed yet (${b.alerts.renewals.money}).`,
      action: `Remind the ${b.alerts.renewals.members} ${plural(L.renewals.count, "member whose plan ends", "members whose plans end")} soon to renew (${b.alerts.renewals.money}).`,
    });
  if (snapshot.dues.total > 0)
    problems.push({
      money: snapshot.dues.total,
      wrong: `Members still owe ${b.dues.total} on their bills.`,
      action: `Collect the pending dues of ${b.dues.total}, oldest first.`,
    });
  if (L.newSlipping.count > 0)
    problems.push({
      money: L.newSlipping.total,
      wrong: `${b.alerts.newMembersSlipping.members} new ${plural(L.newSlipping.count, "member is", "members are")} coming less than ${b.rules.newMemberMinVisits} times (plans worth ${b.alerts.newMembersSlipping.money}).`,
      action: `Call the ${b.alerts.newMembersSlipping.members} new ${plural(L.newSlipping.count, "member", "members")} who ${plural(L.newSlipping.count, "is", "are")} slipping (${b.alerts.newMembersSlipping.money}).`,
    });
  if (L.ptChances.count > 0)
    problems.push({
      money: L.ptChances.total,
      wrong: `${b.alerts.ptChances.members} regular ${plural(L.ptChances.count, "member has", "members have")} never taken personal training (worth ${b.alerts.ptChances.money}).`,
      action: `Offer personal training to the ${b.alerts.ptChances.members} regular ${plural(L.ptChances.count, "member", "members")} (worth ${b.alerts.ptChances.money}).`,
    });
  problems.sort((x, y) => y.money - x.money);

  // A cash warning always goes first: it is about keeping the gym open.
  if (snapshot.cashWarning.on)
    problems.unshift({
      money: Number.POSITIVE_INFINITY,
      wrong: `Cash warning: ${snapshot.cashWarning.reasons.join(" ")}`,
      action:
        cash.set && cash.runwayMonths !== null
          ? `Hold back spending that can wait and collect dues: the money lasts ${b.cash.monthsOfRunway}.`
          : "Hold back spending that can wait and collect dues until members cover the costs.",
    });

  const wrong = problems.slice(0, 3).map((p) => p.wrong);
  if (!wrong.length) wrong.push("Nothing urgent: no member list needs a call today.");

  const actions = problems.map((p) => p.action);
  const fillers = [
    !cash.set ? "Add your opening money in CFO settings to see your cash and runway." : "",
    "Press Refresh after big payments or expenses so these numbers stay fresh.",
    "Look at where the money went (expenses by category) for costs you can cut.",
    "Keep members coming: check the Not coming list again next week.",
  ].filter(Boolean);
  for (const f of fillers) if (actions.length < 3) actions.push(f);

  return [
    "Where you stand",
    ...stand,
    "",
    "What is going wrong",
    ...wrong,
    "",
    "Do this week",
    ...actions.slice(0, 3).map((a, i) => `${i + 1}. ${a}`),
  ].join("\n");
}
