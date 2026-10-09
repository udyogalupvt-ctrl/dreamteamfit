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
