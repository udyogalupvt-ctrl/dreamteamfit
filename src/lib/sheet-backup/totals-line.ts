/**
 * The top line of every tab (row 1): "TOTAL", the sums of the money columns, and one plain sentence
 * such as "42 payments · app shows ₹2,07,049 ✓ matches · updated 13 Oct, 10:42 pm". Also the small
 * month and money helpers the server uses. Pure (no database, no network), unit-tested.
 */
import { colLetter } from "./format.ts";
import type { Cell, Column } from "./types.ts";

/** ₹2,07,049 (lakh / crore grouping); paise only when there are some; negatives as -₹500. */
export function inr(n: number): string {
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100);
  const paise = cents % 100;
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  const tail = paise ? `.${String(paise).padStart(2, "0")}` : "";
  return `${n < 0 && cents > 0 ? "-" : ""}₹${grouped}${tail}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 13 Oct, 10:42 pm in Indian time. */
export function istStamp(d: Date): string {
  const t = new Date(d.getTime() + 5.5 * 3_600_000);
  const h24 = t.getUTCHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${h}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

/** 2026-10 -> "Oct 2026" (the month tab's name). */
export const monthTitle = (ym: string): string =>
  `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? "???"} ${ym.slice(0, 4)}`;

/** "Oct 2026" -> 2026-10, null when the text is not a month tab name. */
export function monthFromTitle(title: string): string | null {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(title);
  const i = m ? MONTHS.indexOf(m[1]!) : -1;
  return m && i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, "0")}` : null;
}

/** The month a day is in: 2026-10-13 -> 2026-10 ("" when it is not a date). */
export const monthOf = (iso: string): string => (/^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : "");

/** 2026-01 -> 2025-12. */
export function prevMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to`, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  while (`${y}-${String(m).padStart(2, "0")}` <= to && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** First and last day counted for a month: never after today (the dashboard counts to today only). */
export function monthRange(ym: string, today: string): { from: string; to: string } {
  const last = `${ym}-31`;
  return { from: `${ym}-01`, to: last < today ? last : today };
}

export function monthTotalsLine(p: {
  count: number;
  appTotal: number;
  matches: boolean;
  stamp: string;
}): string {
  return `${p.count} payments · app shows ${inr(p.appTotal)} ${p.matches ? "✓ matches" : "✗ DIFFERENT"} · updated ${p.stamp}`;
}

/**
 * Row 1 of a tab. The sentence goes in the NAME column (else the 2nd), "TOTAL" in column A when the
 * tab has sums, and each money column marked "sum" gets =SUM(X3:X) (data starts in row 3). A
 * column marked "due" shows `due`.
 */
export function totalsRow<R>(columns: Column<R>[], line: string, due = 0): Cell[] {
  const nameAt = columns.findIndex((c) => c.header === "NAME");
  const lineAt = nameAt >= 0 ? nameAt : Math.min(1, columns.length - 1);
  const hasSums = columns.some((c) => c.money);
  return columns.map((c, i) => {
    if (i === lineAt) return line;
    if (i === 0 && hasSums) return "TOTAL";
    if (c.money === "sum") return `=SUM(${colLetter(i)}3:${colLetter(i)})`;
    if (c.money === "due") return due;
    return "";
  });
}

/** Money columns (marked sum / due) that are empty for every row of the tab: they are hidden. */
export function emptyMoneyColumns<R>(columns: Column<R>[], rows: R[]): boolean[] {
  return columns.map((c) => !!c.money && rows.every((r, i) => !(Number(c.value(r, i)) || 0)));
}
