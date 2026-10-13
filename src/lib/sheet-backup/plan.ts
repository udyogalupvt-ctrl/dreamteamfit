/**
 * What a backup run has to do, as named steps ("month:2026-10", "members", "data:payments"...),
 * and how a new run merges with what an earlier, cut-short run left in the queue. Pure.
 *
 *   quick    after a staff change: the touched months, Members, Dues, the touched docs' restore rows
 *   nightly  this and last month, every other readable tab, every restore tab
 *   full     nightly plus every month since the first payment
 */
import { monthFromTitle, monthsBetween, prevMonth } from "./totals-line.ts";

export type Mode = "quick" | "nightly" | "full";

export interface PlanInput {
  mode: Mode;
  /** Today in Indian time, YYYY-MM-DD. */
  today: string;
  /** Root collections that go in the restore tabs (excluded ones already removed). */
  collections: string[];
  /** Oldest month with money, YYYY-MM (full mode); null when there is none. */
  earliestMonth?: string | null | undefined;
  /** Months to redo (quick). */
  months?: string[] | undefined;
  /** Collections of the docs that changed (quick). */
  touchedCollections?: string[] | undefined;
}

export function stepsFor(p: PlanInput): string[] {
  const current = p.today.slice(0, 7);
  const readable = ["members", "dues", "expenses", "plans", "staff", "packages"];
  if (p.mode === "quick") {
    const months = [...new Set(p.months ?? [])].sort().reverse();
    const touched = new Set(p.touchedCollections ?? []);
    const out = months.map((m) => `month:${m}`);
    out.push("members", "dues");
    if (touched.has("expenses")) out.push("expenses");
    if (touched.has("staff") || touched.has("trainers")) out.push("staff");
    if (touched.has("packages") || touched.has("ptPackages")) out.push("packages");
    if (touched.has("memberships") || touched.has("ptAssignments")) {
      out.push("plans");
    }
    for (const c of [...touched].sort()) if (p.collections.includes(c)) out.push(`touch:${c}`);
    out.push("readme");
    return out;
  }
  const first = p.mode === "full" && p.earliestMonth ? p.earliestMonth : prevMonth(current);
  const months = monthsBetween(first <= prevMonth(current) ? first : prevMonth(current), current)
    .reverse()
    .map((m) => `month:${m}`);
  return [...months, ...readable, ...p.collections.map((c) => `data:${c}`), "readme"];
}

/** Old queue first, then the new steps; no duplicates; a full copy of a collection makes "touch" redundant; readme last. */
export function mergeQueue(existing: string[], add: string[]): string[] {
  const all = [...new Set([...existing, ...add])];
  const full = new Set(all.filter((s) => s.startsWith("data:")).map((s) => s.slice(5)));
  return [
    ...all.filter((s) => s !== "readme" && !(s.startsWith("touch:") && full.has(s.slice(6)))),
    ...(all.includes("readme") ? ["readme"] : []),
  ];
}

const FIXED_FIRST = ["Read me", "Members", "Dues"];
const FIXED_AFTER = ["Expenses", "All plans", "Staff & trainers", "Packages"];

/** The tab order of the sheet: Read me, Members, Dues, months newest first, the rest, hidden restore tabs last. */
export function tabOrder(titles: string[]): string[] {
  const have = new Set(titles);
  const months = titles
    .filter((t) => monthFromTitle(t))
    .sort((a, b) => monthFromTitle(b)!.localeCompare(monthFromTitle(a)!));
  const placed = new Set([...FIXED_FIRST, ...months, ...FIXED_AFTER]);
  const hidden = titles.filter((t) => t.startsWith("_data_")).sort();
  const other = titles.filter((t) => !placed.has(t) && !t.startsWith("_data_"));
  return [
    ...FIXED_FIRST.filter((t) => have.has(t)),
    ...months,
    ...FIXED_AFTER.filter((t) => have.has(t)),
    ...other,
    ...hidden,
  ];
}
