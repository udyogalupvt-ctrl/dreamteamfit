/**
 * One payment taken in two modes: part UPI, part cash ("₹300 PhonePe + ₹1,500 cash" on the
 * register). It is saved as two payments on the same bill, the same day, sharing `splitId` (the
 * UPI part first), so every money screen (Day Book cash, Collected by mode, CFO, Excel) counts
 * each part in its own mode without knowing about splits.
 */
import type { PaymentMethod } from "@/types/models";

export const SPLIT_MODE = "Cash + UPI" as const;
/** "Paid by" as staff choose it: one mode, or Cash + UPI. */
export type PayMode = PaymentMethod | typeof SPLIT_MODE;

export interface PayPart {
  method: PaymentMethod;
  amount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The two parts of a Cash + UPI payment, in paise: cash rounded first, UPI = the total less it
 * (so they always add up to the total).
 */
export function splitParts(total: number, cash: number): PayPart[] {
  const c = round(cash);
  return [
    { method: "UPI", amount: round(round(total) - c) },
    { method: "Cash", amount: c },
  ];
}

/** Why a Cash + UPI payment can't be saved yet ("" = fine): both parts at least 1 paisa. */
export function splitProblem(total: number, cash: number): string {
  const t = round(total);
  const c = round(cash);
  if (!(t > 0)) return "Enter the amount received first.";
  if (!(c > 0)) return "Type the cash part.";
  if (!(round(t - c) > 0)) return "The cash part must be less than the total (the rest is UPI).";
  return "";
}

/**
 * Shares one payment's money split (gym / PT / trainer, `whole`) between two parts: the first
 * part's own (`first`), the second the rest, field by field. So the pair adds up exactly to one
 * payment. A paisa of rounding that would leave the second part below ₹0 in a field stays with
 * the first part instead (no "−₹0.01" lines).
 */
export function shareOut<T extends Record<string, number>>(whole: T, first: T): [T, T] {
  const a: Record<string, number> = { ...first };
  const b: Record<string, number> = {};
  for (const k of Object.keys(whole)) {
    const rest = round((whole[k] ?? 0) - (a[k] ?? 0));
    if (rest < 0) {
      a[k] = round((a[k] ?? 0) + rest);
      b[k] = 0;
    } else b[k] = rest;
  }
  return [a as T, b as T];
}

/** How a payment's money is split (as `allocatePayment` gives it). */
export interface PayAllocation {
  trainerShareAmount: number;
  gymAmount: number;
  membershipGymAmount: number;
  ptGymAmount: number;
  otherGymAmount: number;
  [k: string]: number;
}

/**
 * The share of a saved payment's split (`whole`, for `wholeAmount`) that a part of `partAmount`
 * gets, by its size; gym = the part less its trainer share, like `allocatePayment`. The other part
 * gets the rest (`shareOut`), so a split never changes the totals.
 */
export function scaleAllocation(
  whole: PayAllocation,
  wholeAmount: number,
  partAmount: number,
): PayAllocation {
  const r = wholeAmount > 0 ? partAmount / wholeAmount : 0;
  const trainerShareAmount = round(whole.trainerShareAmount * r);
  const gymAmount = round(partAmount - trainerShareAmount);
  const membershipGymAmount = round(whole.membershipGymAmount * r);
  const ptGymAmount = round(whole.ptGymAmount * r);
  return {
    trainerShareAmount,
    gymAmount,
    membershipGymAmount,
    ptGymAmount,
    otherGymAmount: round(Math.max(0, gymAmount - membershipGymAmount - ptGymAmount)),
  };
}

/**
 * What a bill shows as "paid by" for its checkout payment(s): the bigger part's mode (for screens
 * that show one mode) and, when the parts are in different modes, each mode in order.
 */
export function billModes(parts: PayPart[]): {
  paymentMethod: PaymentMethod;
  paymentModes: PaymentMethod[] | null;
} {
  const modes = [...new Set(parts.map((p) => p.method))];
  const biggest = [...parts].sort((a, b) => b.amount - a.amount)[0];
  return {
    paymentMethod: biggest?.method ?? "Cash",
    paymentModes: modes.length > 1 ? modes : null,
  };
}

/** " (part of Cash + UPI)" after a payment row's mode, so its two rows read as one payment. */
export const splitTag = (p: { splitId?: string | undefined; split?: boolean | undefined }) =>
  p.splitId || p.split ? " (part of Cash + UPI)" : "";

/** "UPI + Cash" for a split bill, else its one mode. */
export function billModesLabel(bill: {
  paymentMethod: string;
  paymentModes?: readonly string[] | null | undefined;
}): string {
  return bill.paymentModes && bill.paymentModes.length > 1
    ? bill.paymentModes.join(" + ")
    : bill.paymentMethod;
}
