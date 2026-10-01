import { addDaysISO } from "@/lib/format";
import type { Expense, ManualIncome, Payment } from "@/types/models";

/**
 * One handover of a day's cash. `givenOn` is when the money actually changed hands: yesterday's
 * cash handed over this morning is booked on yesterday (its day) and remembers it was given today.
 */
export interface HandoverEntry {
  id: string;
  amount: number;
  to: string;
  note: string;
  givenOn: string;
  /** When it was entered (ms) and by whom. */
  at: number;
  by: string;
}

/** What was entered by hand for one day: cash handed over to the owner, or the first opening cash. */
export interface CashDay {
  date: string;
  /** Total handed over out of this day's cash (sum of `handovers`). */
  handover: number;
  handoverTo: string;
  note: string;
  handovers: HandoverEntry[];
  /** Only for the first day (or a correction): cash in the drawer at opening. */
  openingOverride: number | null;
  /**
   * Saved automatically once a month: the opening cash this day had, worked out from all the
   * days before. The Day Book starts from here instead of reading every older record.
   */
  carriedOpening?: number | null;
}

export interface CashBookRow {
  date: string;
  opening: number;
  received: number;
  expenses: number;
  /** opening + received − expenses */
  balance: number;
  handover: number;
  handoverTo: string;
  note: string;
  handovers: HandoverEntry[];
  /** balance − handover = next day's opening */
  closing: number;
}

/** "₹1,000 → Owner" for each handover of a day, with the day it was given when that differs. */
export function handoverSummary(row: Pick<CashBookRow, "date" | "handovers">) {
  return row.handovers
    .map(
      (h) =>
        `₹${h.amount.toLocaleString("en-IN")}${h.to ? ` → ${h.to}` : ""}${
          h.givenOn && h.givenOn !== row.date ? ` (given ${shortDay(h.givenOn)})` : ""
        }`,
    )
    .join(", ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-01" → "1 Oct". */
const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""}`;
};

/**
 * Daily cash register. Cash in = member payments paid in cash. Cash out =
 * expenses paid in cash from the gym, and money paid back in cash to someone who paid an
 * expense from their own pocket. Each day's closing becomes the next day's opening.
 */
export function buildCashBook(
  payments: Pick<Payment, "amount" | "method" | "paymentDate">[],
  manual: Pick<ManualIncome, "amount" | "method" | "date">[],
  expenses: Pick<
    Expense,
    "amount" | "paymentMethod" | "date" | "paidBy" | "settled" | "settledDate" | "settledMethod"
  >[],
  days: CashDay[],
  until: string,
): CashBookRow[] {
  const inByDay = new Map<string, number>();
  const outByDay = new Map<string, number>();
  const add = (m: Map<string, number>, d: string, n: number) => d && m.set(d, (m.get(d) ?? 0) + n);
  payments.filter((p) => p.method === "Cash").forEach((p) => add(inByDay, p.paymentDate, p.amount));
  manual.filter((m) => m.method === "Cash").forEach((m) => add(inByDay, m.date, m.amount));
  for (const e of expenses) {
    if (e.paidBy === "Gym" && e.paymentMethod === "Cash") add(outByDay, e.date, e.amount);
    else if (e.paidBy !== "Gym" && e.settled && e.settledMethod === "Cash")
      add(outByDay, e.settledDate, e.amount);
  }
  const entered = new Map(days.map((d) => [d.date, d]));
  const dates = [...inByDay.keys(), ...outByDay.keys(), ...entered.keys()]
    .filter((d) => d && d <= until)
    .sort();
  if (!dates.length) return [];
  const rows: CashBookRow[] = [];
  let opening = 0;
  for (let d = dates[0]!; d <= until; d = addDaysISO(d, 1)) {
    const day = entered.get(d);
    if (day?.openingOverride !== null && day?.openingOverride !== undefined)
      opening = day.openingOverride;
    else if (day?.carriedOpening !== null && day?.carriedOpening !== undefined)
      opening = day.carriedOpening;
    const received = inByDay.get(d) ?? 0;
    const expensesToday = outByDay.get(d) ?? 0;
    const balance = opening + received - expensesToday;
    const handover = day?.handover ?? 0;
    const closing = balance - handover;
    rows.push({
      date: d,
      opening,
      received,
      expenses: expensesToday,
      balance,
      handover,
      handoverTo: day?.handoverTo ?? "",
      note: day?.note ?? "",
      handovers: day?.handovers ?? [],
      closing,
    });
    opening = closing;
  }
  return rows;
}
