/**
 * Who gets the daily WhatsApp reminders (server/automation.ts). Pure rules only (no database):
 * relative imports, unit-tested with `node --test`.
 */
import { isOldBalanceBill } from "./old-money.ts";

export interface ReminderPlan {
  id: string;
  clientId: string;
  status: string;
  endDate: string;
}

/**
 * Renewal reminders: at most one per member, for the plan that ends last. The member is reminded
 * when their latest-ending plan (running, queued or waiting for the thumb) ends on `target` and is
 * running. Two running plans with the same end date get one message, not two; a later plan
 * (a renewal already sold) means no reminder. Cancelled plans are left out by the caller.
 */
export function renewalReminderPlans<T extends ReminderPlan>(plans: T[], target: string): T[] {
  const byMember = new Map<string, T[]>();
  for (const p of plans) {
    if (p.status === "cancelled") continue;
    byMember.set(p.clientId, [...(byMember.get(p.clientId) ?? []), p]);
  }
  const out: T[] = [];
  for (const list of byMember.values()) {
    const last = list.reduce((a, p) => (p.endDate > a ? p.endDate : a), "");
    if (last !== target) continue;
    // The same plan every run (cron retries never pick another one and send twice).
    const pick = list
      .filter((p) => p.endDate === target && p.status === "active")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (pick) out.push(pick);
  }
  return out;
}

export interface ReminderBill {
  items?: { name: string }[] | undefined;
  amountPaid?: number | undefined;
  remindOldBalance?: boolean | undefined;
}

/**
 * Balance-due reminders skip the balance bill of a plan carried over from the old software: that
 * balance came from the old records and was often paid there already. It is reminded only when
 * staff confirmed it (ticked "Send WhatsApp reminders" on the bill), or once part of it was
 * collected here (the member agreed they owe it).
 */
export const remindsBalance = (bill: ReminderBill) =>
  !isOldBalanceBill({ items: bill.items ?? [] }) ||
  bill.remindOldBalance === true ||
  (Number(bill.amountPaid) || 0) > 0;

const isSunday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 0;
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The gym is closed on Sundays and on the holidays set in Settings → Reminders. */
export const gymClosed = (iso: string, holidays: readonly string[] = []) =>
  isSunday(iso) || holidays.includes(iso);

/**
 * Missed-workout days: the days the gym was open after `since` (the last visit, or the plan
 * start) up to and including `today`. Sundays and holidays don't count: a member who came on
 * Friday has missed 2 days on Monday night, not 3.
 */
export function openDaysMissed(since: string, today: string, holidays: readonly string[] = []) {
  let n = 0;
  for (let d = nextDay(since); d <= today; d = nextDay(d)) if (!gymClosed(d, holidays)) n += 1;
  return n;
}

/**
 * Balance-due reminders go twice per bill: `before` days ahead of the next payment date and on
 * the day itself (not every day in between).
 */
export function paymentDueToday(today: string, dueDate: string, before: number) {
  if (dueDate === today) return true;
  const ahead = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return before > 0 && ahead === before;
}
