import { addDaysISO } from "@/lib/format";
import type { Expense, ManualIncome, Payment } from "@/types/models";

/** What was entered by hand for one day: cash handed over to the owner, or the first opening cash. */
export interface CashDay {
  date: string;
  handover: number;
  handoverTo: string;
  note: string;
  /** Only for the first day (or a correction): cash in the drawer at opening. */
  openingOverride: number | null;
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
  /** balance − handover = next day's opening */
  closing: number;
}

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
      closing,
    });
    opening = closing;
  }
  return rows;
}
