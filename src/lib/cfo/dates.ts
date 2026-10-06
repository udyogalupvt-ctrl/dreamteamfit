/**
 * Day maths on "YYYY-MM-DD" strings. Everything goes through Date.UTC so no time zone or
 * daylight-saving shift can move a day. "Day numbers" are whole days since 1970-01-01.
 */
import type { CfoWindow, ISODate } from "./types.ts";

const MS_PER_DAY = 86_400_000;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Day number of a valid date string, else null (empty, malformed or impossible dates). */
export function toDay(d: string | null | undefined): number | null {
  if (typeof d !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, da);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) {
    return null;
  }
  return Math.round(ms / MS_PER_DAY);
}

export function fromDay(n: number): ISODate {
  const d = new Date(n * MS_PER_DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const day = toDay(d);
  return day === null ? d : fromDay(day + n);
}

/** b − a in days (positive when b is later). Invalid dates give 0. */
export function diffDays(a: ISODate, b: ISODate): number {
  const x = toDay(a);
  const y = toDay(b);
  return x === null || y === null ? 0 : y - x;
}

/** "2026-10" for any date in October 2026. */
export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

export function monthStart(key: string): ISODate {
  return `${key}-01`;
}

export function daysInMonth(key: string): number {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(key: string): ISODate {
  return `${key}-${pad(daysInMonth(key))}`;
}

export function addMonths(key: string, n: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${pad(yy, 4)}-${pad(mm + 1)}`;
}

/** "Sep 2026" */
export function monthLabel(key: string): string {
  return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? "?"} ${key.slice(0, 4)}`;
}

/** Short month name of a "YYYY-MM-DD" date ("Oct"). */
export function monthName(m: number): string {
  return MONTH_NAMES[m - 1] ?? "?";
}

/** The 6 full months before this one plus this one (counted up to `today`). */
export function reportWindow(today: ISODate): CfoWindow {
  const thisKey = monthKey(today);
  const months: CfoWindow["months"] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addMonths(thisKey, -i);
    months.push({ key, from: monthStart(key), to: i === 0 ? today : monthEnd(key) });
  }
  return {
    today,
    windowStart: monthStart(addMonths(thisKey, -6)),
    lastMonthStart: monthStart(addMonths(thisKey, -1)),
    months,
  };
}
