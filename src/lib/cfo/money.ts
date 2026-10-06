/**
 * Display formatters shared by the AI brief and the CFO page, so a number reads exactly the same
 * everywhere. Whole rupees only; "not enough data" stands in for any number that is unknown.
 */
import { monthName, toDay } from "./dates.ts";
import type { ISODate } from "./types.ts";

export const NOT_ENOUGH_DATA = "not enough data";

const grouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Round to a whole rupee. Non-finite input becomes 0 and -0 becomes 0. */
export function roundRupee(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r === 0 ? 0 : r;
}

/** "₹1,90,000"; minus as "-₹5,000". */
export function formatRupees(n: number): string {
  const r = roundRupee(n);
  return `${r < 0 ? "-" : ""}₹${grouping.format(Math.abs(r))}`;
}

export function formatPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return NOT_ENOUGH_DATA;
  return `${Math.round(rate * 100)}%`;
}

export function formatMonths(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return NOT_ENOUGH_DATA;
  return `${m.toFixed(1)} months`;
}

export function formatCount(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return NOT_ENOUGH_DATA;
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}${grouping.format(Math.abs(r))}`;
}

export function formatSignedCount(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `+${grouping.format(r)}`;
  if (r < 0) return `-${grouping.format(-r)}`;
  return "0";
}

/** "2026-10-06" → "6 Oct 2026". Anything that is not a real date is returned unchanged. */
export function formatDay(d: ISODate): string {
  if (toDay(d) === null) return d;
  return `${Number(d.slice(8, 10))} ${monthName(Number(d.slice(5, 7)))} ${d.slice(0, 4)}`;
}
