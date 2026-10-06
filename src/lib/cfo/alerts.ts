/**
 * Layer 2: the problem lists (CFO_PLAN.md 4.4). Pure rules over the plan book and visit days.
 * Rows are sorted by money, highest first (ties by name). Reasons are plain sentences.
 */
import { fromDay, toDay } from "./dates.ts";
import { countsAsNew, fin, groupByClient } from "./plans.ts";
import type { GymEntry, PlanBook, PtEntry } from "./plans.ts";
import { formatDay, roundRupee } from "./money.ts";
import { CFO_LIST_ROW_CAP, CFO_SUMMARY_ROWS } from "./types.ts";
import type {
  CfoAlertRow,
  CfoInput,
  CfoListDoc,
  CfoListKey,
  CfoMember,
  CfoSettings,
} from "./types.ts";

export interface AlertsResult {
  atRisk: CfoAlertRow[];
  renewals: CfoAlertRow[];
  newSlipping: CfoAlertRow[];
  ptChances: CfoAlertRow[];
  /** Members with a running plan whose visits cannot be checked. */
  notTracked: number;
  ptFromPrice: number | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Highest money first, ties by name (plain comparison, so the order never depends on the locale). */
export function sortByMoney<T>(rows: T[], money: (r: T) => number, name: (r: T) => string): T[] {
  return rows.sort((a, b) => {
    const d = money(b) - money(a);
    if (d !== 0) return d;
    const x = name(a);
    const y = name(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function countIn(days: number[], a: number, b: number): number {
  let n = 0;
  for (const d of days) if (d >= a && d <= b) n += 1;
  return n;
}

export function computeAlerts(
  input: CfoInput,
  settings: CfoSettings,
  book: PlanBook,
): AlertsResult {
  const today = toDay(input.today) ?? 0;
  const gymBy = groupByClient(book.gym);
  const ptBy = groupByClient(book.pt);
  const grace = Math.max(0, fin(settings.graceDays));
  const minPrice = input.ptPackagePrices.map(fin).filter((p) => p > 0);
  const ptFromPrice = minPrice.length > 0 ? Math.min(...minPrice) : null;

  const atRisk: CfoAlertRow[] = [];
  const renewals: CfoAlertRow[] = [];
  const newSlipping: CfoAlertRow[] = [];
  const ptChances: CfoAlertRow[] = [];
  let notTracked = 0;

  const row = (
    m: CfoMember,
    plan: GymEntry,
    lastVisit: number | null,
    reason: string,
    kind: string,
    top: boolean,
    money: number,
  ): CfoAlertRow => ({
    clientId: m.id,
    name: m.name,
    phone: m.phone,
    code: m.code,
    plan: plan.label,
    endDate: plan.plan.endDate,
    lastVisit: lastVisit === null ? "" : fromDay(lastVisit),
    money: roundRupee(money),
    reason,
    kind,
    top,
  });

  for (const m of input.members) {
    const gyms = gymBy.get(m.id) ?? [];
    const live = gyms.filter((e) => !e.cancelled);
    // Running plan: not cancelled, not cut short by a newer one, covering today (latest end wins).
    let running: GymEntry | null = null;
    for (const e of live) {
      if (e.superseded || e.startDay === null || e.effEndDay === null) continue;
      if (e.startDay > today || e.effEndDay < today) continue;
      if (running === null || (e.endDay ?? 0) > (running.endDay ?? 0)) running = e;
    }
    if (running === null) continue;

    // Visit days (sorted), up to today.
    const visitDays: number[] = [];
    for (const d of input.visits[m.id] ?? []) {
      const n = toDay(d);
      if (n !== null) visitDays.push(n);
    }
    const lv = toDay(m.lastVisitDate);
    if (lv !== null) visitDays.push(lv);
    const uniq = [...new Set(visitDays)].filter((d) => d <= today).sort((a, b) => a - b);
    const lastVisit = uniq.length > 0 ? (uniq[uniq.length - 1] as number) : null;
    const tracked = m.tracked || uniq.length > 0;
    if (!tracked) notTracked += 1;

    // Paused days over all of the member's plans.
    const paused: [number, number][] = [];
    for (const e of live) for (const r of e.spread.paused) paused.push(r);
    const pausedIn = (a: number, b: number) => {
      const seen = new Set<number>();
      for (const [x, y] of paused) {
        for (let d = Math.max(x, a); d <= Math.min(y, b); d++) seen.add(d);
      }
      return seen.size;
    };
    const pausedToday = pausedIn(today, today) > 0;

    // Start of the member's unbroken run of plans (a gap up to the grace period keeps the run).
    let runStart = running.startDay as number;
    for (;;) {
      let best: GymEntry | null = null;
      for (const e of live) {
        if (e.startDay === null || e.endDay === null || e.startDay >= runStart) continue;
        if (runStart - e.endDay > grace) continue;
        if (best === null || e.startDay < (best.startDay as number)) best = e;
      }
      if (best === null) break;
      runStart = best.startDay as number;
    }
    const thumb = toDay(m.thumbSince);
    const from = thumb !== null ? Math.max(thumb, runStart) : runStart;

    const planMoney = running.value;
    let atRiskKind = "";

    if (tracked && !pausedToday) {
      const ref = Math.max(lastVisit ?? from, from);
      const sinceVisit = today - ref - pausedIn(ref + 1, today);
      const limit = Math.max(1, Math.round(fin(settings.atRiskDays)));
      const earlier = countIn(uniq, today - 27, today - 14);
      const last = countIn(uniq, today - 13, today);
      if (sinceVisit >= limit) {
        atRiskKind = "notComing";
        const reason =
          lastVisit === null || lastVisit < from
            ? `No visit since joining (${sinceVisit} ${plural(sinceVisit, "day", "days")})`
            : `No visit for ${sinceVisit} ${plural(sinceVisit, "day", "days")}`;
        atRisk.push(row(m, running, lastVisit, reason, "notComing", false, planMoney));
      } else if (
        from <= today - 27 &&
        pausedIn(today - 27, today) === 0 &&
        earlier >= 4 &&
        last * 2 <= earlier
      ) {
        atRiskKind = "dropping";
        atRisk.push(
          row(
            m,
            running,
            lastVisit,
            `Visits dropped: ${earlier} in the earlier 14 days, ${last} in the last 14 days`,
            "dropping",
            false,
            planMoney,
          ),
        );
      }
    }

    // Renewals: the running plan ends soon and nothing later is bought.
    const endDay = running.endDay as number;
    const left = endDay - today;
    if (left >= 0 && left <= Math.max(0, Math.round(fin(settings.renewalDays)))) {
      const later = live.some(
        (e) =>
          e !== running &&
          !e.superseded &&
          !e.upgraded &&
          e.startDay !== null &&
          running.startDay !== null &&
          e.startDay > running.startDay &&
          e.endDay !== null &&
          e.endDay > endDay,
      );
      if (!later) {
        const base =
          left === 0
            ? "Plan ends today"
            : `Plan ends in ${left} ${plural(left, "day", "days")} (on ${formatDay(running.plan.endDate)})`;
        const top = atRiskKind !== "";
        renewals.push(
          row(
            m,
            running,
            lastVisit,
            top ? `${base}. Top priority: also not coming` : base,
            "",
            top,
            planMoney,
          ),
        );
      }
    }

    // New members slipping: joined 7..30 days ago and few visits since.
    const joined = toDay(m.joinedOn);
    if (joined !== null && !pausedToday) {
      const ago = today - joined;
      const waiting = running.plan.status === "biometric_pending";
      if (
        ago >= 7 &&
        ago <= 30 &&
        (tracked || waiting) &&
        countsAsNew(gyms, ptBy.get(m.id) ?? [])
      ) {
        const v = countIn(uniq, joined, today);
        const min = Math.max(1, Math.round(fin(settings.newMemberMinVisits)));
        if (v < min) {
          newSlipping.push(
            row(
              m,
              running,
              lastVisit,
              `Joined ${ago} days ago, ${v} ${plural(v, "visit", "visits")} so far (needs ${min})`,
              "",
              false,
              planMoney,
            ),
          );
        }
      }
    }

    // PT chances: comes often and has never bought personal training.
    const pts: PtEntry[] = ptBy.get(m.id) ?? [];
    if (!pts.some((p) => !p.cancelled)) {
      const v = countIn(uniq, today - 29, today);
      if (v >= Math.max(1, Math.round(fin(settings.ptMinVisits)))) {
        ptChances.push(
          row(
            m,
            running,
            lastVisit,
            `${v} visits in the last 30 days and no personal training yet`,
            "",
            false,
            ptFromPrice ?? 0,
          ),
        );
      }
    }
  }

  const byMoney = (rows: CfoAlertRow[]) =>
    sortByMoney(
      rows,
      (r) => r.money,
      (r) => r.name,
    );
  return {
    atRisk: byMoney(atRisk),
    renewals: byMoney(renewals),
    newSlipping: byMoney(newSlipping),
    ptChances: byMoney(ptChances),
    notTracked,
    ptFromPrice,
  };
}

/* ------------------------------------------------------------------ list docs */

const encoder = new TextEncoder();
const MAX_DOC_BYTES = 800_000;

/** The summary part kept inside `cfoReports/latest`. */
export function summarize<Row>(rows: Row[], total: number) {
  return { count: rows.length, total, rows: rows.slice(0, CFO_SUMMARY_ROWS) };
}

/**
 * The full list doc: at most CFO_LIST_ROW_CAP rows and under ~800 KB. Rows arrive sorted with the
 * most money first, so the lowest-money rows are the ones dropped.
 */
export function buildListDoc<Row>(
  key: CfoListKey,
  rows: Row[],
  total: number,
  computedAt: string,
): CfoListDoc<Row> {
  let keep = Math.min(rows.length, CFO_LIST_ROW_CAP);
  const sizes = rows.slice(0, keep).map((r) => encoder.encode(JSON.stringify(r)).length + 1);
  const shell = (n: number): CfoListDoc<Row> => ({
    key,
    computedAt,
    count: rows.length,
    total,
    rows: rows.slice(0, n),
    truncated: rows.length - n,
  });
  const overhead = encoder.encode(JSON.stringify(shell(0))).length + 16;
  let bytes = overhead + sizes.reduce((a, b) => a + b, 0);
  while (keep > 0 && bytes >= MAX_DOC_BYTES) {
    keep -= 1;
    bytes -= sizes[keep] ?? 0;
  }
  let doc = shell(keep);
  // Safety net: the estimate above is exact for ASCII and close for the rest.
  while (keep > 0 && encoder.encode(JSON.stringify(doc)).length >= MAX_DOC_BYTES) {
    keep -= 1;
    doc = shell(keep);
  }
  return doc;
}
