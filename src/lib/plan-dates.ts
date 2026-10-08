/**
 * A plan's last day, the way the old gym software counted it and members expect: calendar months,
 * ending the day before the same date (1 Sep → 30 Sep, 24 Jul → 23 Aug, 12 Aug 2026 → 11 Aug
 * 2027). The plan covers its last day (the door opens on it). Packages are stored in days: 30, 60,
 * 90, 180, 360 days = 1, 2, 3, 6, 12 months; 365 / 366 = 1 year; anything else is that many days
 * (a 1-day pass ends the same day, 15 days → start + 14).
 *
 * Pure (no imports), so it is unit-tested with node --test and used by browser and server alike.
 */

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const toISO = (d: Date) => d.toISOString().slice(0, 10);

/** The months a package length stands for, or 0 when it is a plain number of days. */
export function packageMonths(durationDays: number) {
  if (durationDays === 365 || durationDays === 366) return 12;
  return durationDays > 0 && durationDays % 30 === 0 ? durationDays / 30 : 0;
}

/** Same date `months` later; a day the month lacks becomes its last day (31 Jan → 28/29 Feb). */
function addMonthsClamped(iso: string, months: number) {
  const d = toUTC(iso);
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first;
}

export function planEndDate(startDate: string, durationDays: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return startDate;
  const months = packageMonths(durationDays);
  const end = months
    ? addMonthsClamped(startDate, months)
    : new Date(toUTC(startDate).getTime() + Math.max(1, Math.round(durationDays)) * 86_400_000);
  // The day before: the plan's own last day.
  end.setUTCDate(end.getUTCDate() - 1);
  return toISO(end);
}

/** Days a plan covers, its last day included. */
export function planDays(startDate: string, endDate: string) {
  return Math.round((toUTC(endDate).getTime() - toUTC(startDate).getTime()) / 86_400_000) + 1;
}
