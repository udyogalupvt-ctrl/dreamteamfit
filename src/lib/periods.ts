/**
 * The date choices the lists and reports offer (Today, Yesterday, 2 … 5 days back, This week, This
 * month, a picked date, From – to), turned into a from / to range of yyyy-MM-dd days.
 *
 * Pure maths only (no React, no clock: `today` is passed in): relative imports, unit-tested with
 * `node --test`. The picker on screen is `components/common/period-picker.tsx`.
 */

export const PERIOD_CHOICES = [
  "today",
  "yesterday",
  "back2",
  "back3",
  "back4",
  "back5",
  "week",
  "month",
  "lastMonth",
  "year",
  "all",
  "date",
  "range",
] as const;
export type PeriodChoice = (typeof PERIOD_CHOICES)[number];

/** What every date filter offers (the owner's list, 2026-10-13). */
export const DAY_CHOICES: PeriodChoice[] = [
  "today",
  "yesterday",
  "back2",
  "back3",
  "back4",
  "back5",
  "week",
  "month",
  "date",
  "range",
];

/** The owner's list plus a page's extras (Last month, This year, All dates), after "This month". */
export function choicesWith(...extra: PeriodChoice[]): PeriodChoice[] {
  const at = DAY_CHOICES.indexOf("month") + 1;
  return [...DAY_CHOICES.slice(0, at), ...extra, ...DAY_CHOICES.slice(at)];
}

/** The days shown: `label` fits after "Numbers · " / "Collected · ". */
export interface Period {
  from: string;
  to: string;
  label: string;
  isToday: boolean;
}

/** What was typed for "Pick a date…" (`day`) and "From – to…" (`from`, `to`). */
export interface PeriodInput {
  day?: string;
  from?: string;
  to?: string;
}

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(ms(day) + n * DAY);
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** "Sun 11 Oct", with the year when it is not this year's. */
export function dayText(day: string, today: string): string {
  const d = new Date(ms(day));
  if (Number.isNaN(d.getTime())) return day;
  const year = day.slice(0, 4) === today.slice(0, 4) ? "" : ` ${d.getUTCFullYear()}`;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}

const BACK: Partial<Record<PeriodChoice, number>> = { back2: 2, back3: 3, back4: 4, back5: 5 };

/** The name of a choice in the list. */
export function choiceText(choice: PeriodChoice, today: string): string {
  const back = BACK[choice];
  if (back) return `${back} days back · ${dayText(addDays(today, -back), today)}`;
  return {
    today: "Today",
    yesterday: "Yesterday",
    week: "This week",
    month: "This month",
    lastMonth: "Last month",
    year: "This year",
    all: "All dates",
    date: "Pick a date…",
    range: "From – to…",
  }[choice as Exclude<PeriodChoice, "back2" | "back3" | "back4" | "back5">];
}

function oneDay(day: string, today: string): Period {
  const label =
    day === today ? "today" : day === addDays(today, -1) ? "yesterday" : dayText(day, today);
  return { from: day, to: day, label, isToday: day === today };
}

/** The days a choice covers. A picked date or range never goes past today. */
export function periodFor(choice: PeriodChoice, today: string, input: PeriodInput = {}): Period {
  const upToToday = (d: string | undefined) => (d && d <= today ? d : today);
  const span = (from: string, to: string, label: string): Period => ({
    from,
    to,
    label,
    isToday: from === today && to === today,
  });
  const back = BACK[choice];
  if (back) return oneDay(addDays(today, -back), today);
  switch (choice) {
    case "yesterday":
      return oneDay(addDays(today, -1), today);
    case "week": {
      const sinceMonday = (new Date(ms(today)).getUTCDay() + 6) % 7;
      return span(addDays(today, -sinceMonday), today, "this week");
    }
    case "month":
      return span(firstOfMonth(today), today, "this month");
    case "lastMonth": {
      const first = firstOfMonth(today);
      return span(firstOfMonth(addDays(first, -1)), addDays(first, -1), "last month");
    }
    case "year":
      return span(`${today.slice(0, 4)}-01-01`, today, "this year");
    case "all":
      return { from: "0000-01-01", to: "9999-12-31", label: "all dates", isToday: false };
    case "date":
      return oneDay(upToToday(input.day), today);
    case "range": {
      let [a, b] = [upToToday(input.from), upToToday(input.to)];
      if (a > b) [a, b] = [b, a];
      return a === b ? oneDay(a, today) : span(a, b, `${dayText(a, today)} – ${dayText(b, today)}`);
    }
    default:
      return oneDay(today, today);
  }
}

/** The days covered, shown beside the list ("Mon 12 Oct – Tue 13 Oct"); "" for all dates. */
export function periodSpan(p: Period, today: string): string {
  if (p.from === "0000-01-01") return "";
  return p.from === p.to
    ? dayText(p.from, today)
    : `${dayText(p.from, today)} – ${dayText(p.to, today)}`;
}

/**
 * Money paid in the old software that lands on a ONE-day period. Its date is the old plan's start
 * (the old software keeps no payment date), so a day's "Collected" leaves it out like the Day Book
 * does; a longer period (a month) still counts it. 0 for multi-day periods.
 */
export function oldMoneyOnDay(
  payments: { oldSoftware?: boolean | undefined; paymentDate: string; amount: number }[],
  from: string,
  to: string,
): number {
  if (from !== to) return 0;
  return payments
    .filter((p) => p.oldSoftware && p.paymentDate === from)
    .reduce((n, p) => n + p.amount, 0);
}
