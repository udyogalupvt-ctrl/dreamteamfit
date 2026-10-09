/**
 * Plan values and spreading (CFO_PLAN.md 4.1 and 4.2).
 *
 * `buildPlanBook` turns bills, plans, refunds and trainer payouts into one entry per gym plan and
 * per PT plan: how much the plan is worth (tax taken out), how much of that was paid, and a
 * `SpreadItem` that says how much of it is earned on any range of days. Nothing here rounds:
 * the monthly numbers round once per leaf (numbers.ts).
 */
import { addDays, fromDay, toDay } from "./dates.ts";
import type {
  CfoBill,
  CfoGymPlan,
  CfoInput,
  CfoPause,
  CfoPayout,
  CfoPtPlan,
  ISODate,
} from "./types.ts";

/** Any non-finite number (NaN, Infinity, a string) becomes 0 so it can never reach the page. */
export const fin = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/* ------------------------------------------------------------------ spreading */

export interface SpreadItem {
  /** Day numbers (see dates.ts). `start` null = unusable start date: earns nothing anywhere. */
  start: number | null;
  end: number | null;
  /** Merged paused ranges inside [start, end], inclusive. */
  paused: [number, number][];
  value: number;
  stopOn: number | null;
  /** Lifetime value when `stopOn` is set. */
  final: number;
  /** Days of [start, end] that are not paused. */
  totalActive: number;
  /** Dates are unusable: the whole value goes on the start day. */
  bad: boolean;
}

export interface SpreadParams {
  start: ISODate;
  /** The original last day (before any cut by an upgrade). */
  end: ISODate | "";
  pauses: CfoPause[];
  value: number;
  stopOn?: ISODate | null;
  final?: number;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function pausedOverlap(paused: [number, number][], a: number, b: number): number {
  let n = 0;
  for (const [x, y] of paused) {
    const lo = Math.max(x, a);
    const hi = Math.min(y, b);
    if (hi >= lo) n += hi - lo + 1;
  }
  return n;
}

export function makeSpread(p: SpreadParams): SpreadItem {
  const start = toDay(p.start);
  const end = toDay(p.end);
  const stop = p.stopOn ? toDay(p.stopOn) : null;
  const value = fin(p.value);
  const final = p.final === undefined ? value : fin(p.final);
  let paused: [number, number][] = [];
  let totalActive = 0;
  if (start !== null && end !== null && end >= start) {
    paused = mergeRanges(
      p.pauses.flatMap((x): [number, number][] => {
        const on = toDay(x.on);
        const days = Math.floor(fin(x.days));
        if (on === null || days < 1) return [];
        const lo = Math.max(on, start);
        const hi = Math.min(on + days - 1, end);
        return hi >= lo ? [[lo, hi]] : [];
      }),
    );
    totalActive = end - start + 1 - pausedOverlap(paused, start, end);
  }
  const bad = start === null || end === null || end < start || totalActive <= 0;
  return { start, end, paused, value, stopOn: stop, final, totalActive, bad };
}

function activeBetween(s: SpreadItem, a: number, b: number): number {
  if (b < a) return 0;
  return b - a + 1 - pausedOverlap(s.paused, a, b);
}

/** Active (not paused) days of the plan inside [a, b], both day numbers. */
export function activeDays(s: SpreadItem, a: number, b: number): number {
  if (s.start === null || s.end === null || s.bad) return 0;
  return activeBetween(s, Math.max(a, s.start), Math.min(b, s.end));
}

/** What the plan earns on the days a..b (day numbers). Can be minus on a stop day. */
export function earnedBetween(s: SpreadItem, a: number, b: number): number {
  if (s.start === null || b < a) return 0;
  if (s.bad) {
    const amount = s.stopOn !== null ? s.final : s.value;
    return s.start >= a && s.start <= b ? amount : 0;
  }
  const end = s.end as number;
  const hi = s.stopOn !== null ? Math.min(end, s.stopOn - 1) : end;
  let v = (s.value * activeBetween(s, Math.max(a, s.start), Math.min(b, hi))) / s.totalActive;
  if (s.stopOn !== null && a <= s.stopOn && s.stopOn <= b) {
    const before = (s.value * activeBetween(s, s.start, hi)) / s.totalActive;
    v += s.final - before;
  }
  return v;
}

export function earnedInRange(s: SpreadItem, from: ISODate, to: ISODate): number {
  const a = toDay(from);
  const b = toDay(to);
  return a === null || b === null ? 0 : earnedBetween(s, a, b);
}

/** Total the plan ends up earning, however long it runs. */
export function lifetimeOf(s: SpreadItem): number {
  return s.stopOn !== null ? s.final : s.value;
}

/* ------------------------------------------------------------------ the book */

interface EntryBase {
  id: string;
  clientId: string;
  /** Package name (for the lists). */
  label: string;
  listPrice: number;
  startDay: number | null;
  endDay: number | null;
  /** Last day it covers the member (cut at the supersede day); null = unusable dates. */
  effEndDay: number | null;
  cancelled: boolean;
  superseded: boolean;
  /** Old software / import: valued at list price. */
  old: boolean;
  /** Plan value, tax out. */
  value: number;
  /** Paid so far, tax out (credit counted as paid). */
  paid: number;
  /** Paid without the upgrade credit (what is really held for the unused days). */
  paidEff: number;
  /** Income to the gym, with the stop day of a cancel / upgrade / supersede. */
  spread: SpreadItem;
  /** The same value spread with no stop (for "used so far" in the advance). */
  plain: SpreadItem;
}

export interface GymEntry extends EntryBase {
  kind: "gym";
  plan: CfoGymPlan;
  upgraded: boolean;
}

export interface PtEntry extends EntryBase {
  kind: "pt";
  plan: CfoPtPlan;
  trainerId: string;
  /** The trainer's share, spread the same way (a cost, not income). */
  share: SpreadItem;
}

export interface OrphanLine {
  date: ISODate;
  gym: number;
  pt: number;
  trainerShare: number;
}

export interface PlanBook {
  gym: GymEntry[];
  pt: PtEntry[];
  /** Bills whose plan no longer exists, earned on the bill date. */
  orphans: OrphanLine[];
  /** Non-plan lines of bills, earned on the bill date. */
  otherLines: { date: ISODate; amount: number }[];
  /** Plain-language notes about data that was skipped or guessed. No names. */
  notes: string[];
}

interface Money {
  value: number;
  paid: number;
  credit: number;
  /** ex-tax share of the bill (1 = no tax), for scaling refunds. */
  ratio: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function weights(list: number[]): number[] {
  const sum = list.reduce((a, b) => a + b, 0);
  if (sum > 0) return list.map((x) => x / sum);
  return list.map(() => (list.length > 0 ? 1 / list.length : 0));
}

/** What the trainer is finally paid for a PT plan: its non-cancelled lines, adjustments included. */
function finalShare(lines: CfoPayout[]): number {
  let s = 0;
  for (const l of lines) if (l.status !== "cancelled") s += fin(l.trainerShareAmount);
  return s;
}

export function buildPlanBook(input: CfoInput): PlanBook {
  const notes: string[] = [];
  const bills = input.bills;
  const billsById = new Map<string, CfoBill>();
  const billByGym = new Map<string, CfoBill>();
  const billByPt = new Map<string, CfoBill>();
  for (const b of bills) {
    billsById.set(b.id, b);
    if (b.membershipId && !billByGym.has(b.membershipId)) billByGym.set(b.membershipId, b);
    if (b.ptAssignmentId && !billByPt.has(b.ptAssignmentId)) billByPt.set(b.ptAssignmentId, b);
  }
  const gymIds = new Set(input.gymPlans.map((p) => p.id));
  const ptIds = new Set(input.ptPlans.map((p) => p.id));

  const payoutsByPlan = new Map<string, CfoPayout[]>();
  for (const l of input.payouts) {
    const list = payoutsByPlan.get(l.ptAssignmentId);
    if (list) list.push(l);
    else payoutsByPlan.set(l.ptAssignmentId, [l]);
  }

  /* ---- which bill belongs to which plan */
  const gymBill = new Map<string, CfoBill>();
  const ptBill = new Map<string, CfoBill>();
  const linkedGym = new Map<string, CfoGymPlan[]>();
  const linkedPt = new Map<string, CfoPtPlan[]>();
  for (const p of input.gymPlans) {
    const b = (p.invoiceId ? billsById.get(p.invoiceId) : undefined) ?? billByGym.get(p.id);
    if (!b) continue;
    gymBill.set(p.id, b);
    const l = linkedGym.get(b.id);
    if (l) l.push(p);
    else linkedGym.set(b.id, [p]);
  }
  for (const p of input.ptPlans) {
    const b = (p.invoiceId ? billsById.get(p.invoiceId) : undefined) ?? billByPt.get(p.id);
    if (!b) continue;
    ptBill.set(p.id, b);
    const l = linkedPt.get(b.id);
    if (l) l.push(p);
    else linkedPt.set(b.id, [p]);
  }

  /* ---- 4.1: split every bill */
  const gymMoney = new Map<string, Money>();
  const ptMoney = new Map<string, Money>();
  const orphans: OrphanLine[] = [];
  const otherLines: { date: ISODate; amount: number }[] = [];
  let orphanBills = 0;

  for (const b of bills) {
    const gl = linkedGym.get(b.id) ?? [];
    const pl = linkedPt.get(b.id) ?? [];
    const S = Math.max(0, fin(b.subtotal));
    const D = Math.min(Math.max(0, fin(b.discount)), S);
    const total = fin(b.total);
    const ratio = total > 0 ? Math.min(1, Math.max(0, (S - D) / total)) : 1;
    const setAll = (
      value: number,
      paid: number,
      credit: number,
      list: number[],
      isGym: boolean,
    ) => {
      const w = weights(list);
      (isGym ? gl : pl).forEach((p, i) => {
        const m: Money = {
          value: value * (w[i] ?? 0),
          paid: paid * (w[i] ?? 0),
          credit: credit * (w[i] ?? 0),
          ratio,
        };
        (isGym ? gymMoney : ptMoney).set(p.id, m);
      });
    };

    const linkedAll = [...gl, ...pl];
    const fromOld = linkedAll.length > 0 && linkedAll.some((p) => p.paidInOldSoftware);
    // An old-software balance bill can be ₹0 (the whole balance was found paid there): it still
    // goes to the old-software branch below (list prices), like an old plan without a bill.
    if (S <= 0 && !fromOld) {
      setAll(
        0,
        0,
        0,
        gl.map((p) => fin(p.listPrice)),
        true,
      );
      setAll(
        0,
        0,
        0,
        pl.map((p) => fin(p.listPrice)),
        false,
      );
      continue;
    }

    if (fromOld) {
      // Old software: the real price is unknown, so use list prices and the open amount.
      const open = Math.max(0, fin(b.balanceDue) + fin(b.closedAmount)) * ratio;
      const lists = linkedAll.map((p) => Math.max(0, fin(p.listPrice)));
      const sum = lists.reduce((a, c) => a + c, 0);
      linkedAll.forEach((p, i) => {
        const list = lists[i] ?? 0;
        const share = sum > 0 ? Math.min(list, (open * list) / sum) : 0;
        const m: Money = { value: list, paid: Math.max(0, list - share), credit: 0, ratio };
        if (i < gl.length) gymMoney.set(p.id, m);
        else ptMoney.set(p.id, m);
      });
      continue;
    }

    const mg = Math.max(0, fin(b.membershipGross));
    const pg = Math.max(0, fin(b.ptGross));
    // Only bills from the report window can be orphans: older unpaid bills are loaded for the
    // dues list while their (ended) plans are not, and those plans still exist.
    const inWindow = b.invoiceDate >= input.windowStart;
    const orphanM = inWindow && !!b.membershipId && gl.length === 0 && !gymIds.has(b.membershipId);
    const orphanP =
      inWindow && !!b.ptAssignmentId && pl.length === 0 && !ptIds.has(b.ptAssignmentId);
    const gymList = gl.reduce((a, p) => a + Math.max(0, fin(p.listPrice)), 0);
    const ptList = pl.reduce((a, p) => a + Math.max(0, fin(p.listPrice)), 0);
    let gM = gl.length > 0 ? (mg > 0 ? mg : gymList) : orphanM ? mg : 0;
    let gP = pl.length > 0 ? (pg > 0 ? pg : ptList) : orphanP ? pg : 0;
    if ((orphanM || orphanP) && gM + gP === 0) {
      if (orphanM) gM = S;
      else gP = S;
    }
    if (gM + gP > S) {
      const f = S / (gM + gP);
      gM *= f;
      gP *= f;
    }
    const gO = S - gM - gP;

    // Credit for the unused days of an upgraded plan: part of the discount, already paid.
    const cMax = gM >= S ? D : gM > 0 ? ((S - D) * gM) / (S - gM) : 0;
    const credit = Math.max(0, Math.min(Math.max(0, fin(b.upgradeCredit)), D, cMax));
    const base = S - (D - credit);
    const vM = (base * gM) / S;
    const vP = (base * gP) / S;
    const vO = (base * gO) / S;
    const cash = total > 0 ? (Math.max(0, fin(b.amountPaid)) * (S - D)) / total : 0;
    const aM = Math.max(0, vM - credit);
    const sumA = aM + vP + vO;
    const part = (a: number) => (sumA > 0 ? (cash * a) / sumA : 0);
    const paidM = part(aM) + credit;
    const paidP = part(vP);

    setAll(
      vM,
      paidM,
      credit,
      gl.map((p) => fin(p.listPrice)),
      true,
    );
    setAll(
      vP,
      paidP,
      0,
      pl.map((p) => fin(p.listPrice)),
      false,
    );
    if (vO > 0) otherLines.push({ date: b.invoiceDate, amount: vO });
    if (orphanM || orphanP) {
      orphanBills += 1;
      const share =
        orphanP && b.ptAssignmentId ? finalShare(payoutsByPlan.get(b.ptAssignmentId) ?? []) : 0;
      orphans.push({
        date: b.invoiceDate,
        gym: orphanM ? vM : 0,
        pt: orphanP ? vP : 0,
        trainerShare: share,
      });
    }
  }

  /* ---- refunds by cancel */
  const refunds = new Map<string, number>();
  for (const p of input.payments) {
    if (p.kind === "refund" && p.cancelId) {
      refunds.set(p.cancelId, (refunds.get(p.cancelId) ?? 0) + Math.abs(fin(p.amount)));
    }
  }

  /* ---- money per plan (with the fallbacks for plans that have no bill) */
  let missingBill = 0;
  let listPriced = 0;
  const gymBase = (p: CfoGymPlan): Money => {
    const m = gymMoney.get(p.id);
    if (m) return m;
    const list = Math.max(0, fin(p.listPrice));
    if (p.paidInOldSoftware || p.imported) {
      listPriced += 1;
      return { value: list, paid: list, credit: 0, ratio: 1 };
    }
    missingBill += 1;
    return { value: 0, paid: 0, credit: 0, ratio: 1 };
  };
  const ptBase = (p: CfoPtPlan): Money => {
    const m = ptMoney.get(p.id);
    if (m) return m;
    const list = Math.max(0, fin(p.listPrice));
    if (p.paidInOldSoftware) {
      listPriced += 1;
      return { value: list, paid: list, credit: 0, ratio: 1 };
    }
    missingBill += 1;
    return { value: 0, paid: 0, credit: 0, ratio: 1 };
  };
  const gymM = new Map(input.gymPlans.map((p) => [p.id, gymBase(p)] as const));
  const ptM = new Map(input.ptPlans.map((p) => [p.id, ptBase(p)] as const));

  /* ---- refund shares for each cancel (shared by paid amount, tax out) */
  const isCancelledGym = (p: CfoGymPlan) => p.status === "cancelled" || p.cancelledOn !== null;
  const isCancelledPt = (p: CfoPtPlan) => p.status === "cancelled" || p.cancelledOn !== null;
  const groups = new Map<string, { key: string; paid: number; ratio: number }[]>();
  const addToGroup = (cancelId: string | null, key: string, m: Money) => {
    if (!cancelId) return;
    const g = groups.get(cancelId);
    const row = { key, paid: m.paid, ratio: m.ratio };
    if (g) g.push(row);
    else groups.set(cancelId, [row]);
  };
  for (const p of input.gymPlans)
    if (isCancelledGym(p)) addToGroup(p.cancelId, `g:${p.id}`, gymM.get(p.id)!);
  for (const p of input.ptPlans)
    if (isCancelledPt(p)) addToGroup(p.cancelId, `p:${p.id}`, ptM.get(p.id)!);
  const refundShare = new Map<string, number>();
  for (const [cancelId, rows] of groups) {
    const total = refunds.get(cancelId) ?? 0;
    if (total <= 0) continue;
    const w = weights(rows.map((r) => r.paid));
    rows.forEach((r, i) => refundShare.set(r.key, total * (w[i] ?? 0) * r.ratio));
  }

  /* ---- gym entries */
  const gymByClient = new Map<string, CfoGymPlan[]>();
  for (const p of input.gymPlans) {
    if (isCancelledGym(p)) continue;
    const l = gymByClient.get(p.clientId);
    if (l) l.push(p);
    else gymByClient.set(p.clientId, [p]);
  }
  let badDates = 0;

  const gym: GymEntry[] = input.gymPlans.map((p) => {
    const m = gymM.get(p.id)!;
    const cancelled = isCancelledGym(p);
    const upgraded = !cancelled && !!p.upgradedTo;
    const startDay = toDay(p.startDate);
    const endDay = toDay(p.endDate);
    // The credit the new plan's bill really applied (staff can change it, the bill caps it), so
    // old + new plans earn exactly the money kept. Not capped: a credit above what the member
    // paid is a loss booked on the upgrade day.
    const applied = p.upgradedTo ? gymM.get(p.upgradedTo)?.credit : undefined;
    const credit = Math.max(0, applied ?? fin(p.upgradeCredit));
    let superseded = false;
    let stopOn: ISODate | null = null;
    let final = m.value;
    let totalEnd: ISODate | "" = p.endDate;
    if (cancelled) {
      stopOn = p.cancelledOn ?? p.startDate;
      final = Math.max(0, m.paid - (refundShare.get(`g:${p.id}`) ?? 0));
    } else if (upgraded) {
      totalEnd = p.originalEndDate ?? p.endDate;
      stopOn = p.upgradeFrom ?? (endDay !== null ? addDays(p.endDate, 1) : null);
      final = m.value - credit;
    } else if (p.status === "expired" && startDay !== null && endDay !== null) {
      let cut: number | null = null;
      for (const o of gymByClient.get(p.clientId) ?? []) {
        if (o.id === p.id) continue;
        const os = toDay(o.startDate);
        if (os !== null && os > startDay && os <= endDay && (cut === null || os < cut)) cut = os;
      }
      if (cut !== null) {
        superseded = true;
        stopOn = fromDay(cut);
      }
    }
    const spread = makeSpread({
      start: p.startDate,
      end: totalEnd,
      pauses: p.pauses,
      value: m.value,
      stopOn,
      final,
    });
    const plain = makeSpread({
      start: p.startDate,
      end: totalEnd,
      pauses: p.pauses,
      value: m.value,
    });
    if (spread.bad && !cancelled) badDates += 1;
    const stopDay = stopOn ? toDay(stopOn) : null;
    return {
      kind: "gym",
      plan: p,
      id: p.id,
      clientId: p.clientId,
      label: p.packageName,
      listPrice: Math.max(0, fin(p.listPrice)),
      startDay,
      endDay,
      effEndDay:
        superseded && stopDay !== null && endDay !== null ? Math.min(endDay, stopDay - 1) : endDay,
      cancelled,
      upgraded,
      superseded,
      old: p.paidInOldSoftware || (p.imported && !gymBill.has(p.id)),
      value: m.value,
      paid: m.paid,
      paidEff: upgraded ? Math.max(0, m.paid - credit) : m.paid,
      spread,
      plain,
    };
  });

  /* ---- PT entries */
  const pt: PtEntry[] = input.ptPlans.map((p) => {
    const m = ptM.get(p.id)!;
    const cancelled = isCancelledPt(p);
    const startDay = toDay(p.startDate);
    const endDay = toDay(p.endDate);
    const stopOn = cancelled ? (p.cancelledOn ?? p.startDate) : null;
    const final = cancelled ? Math.max(0, m.paid - (refundShare.get(`p:${p.id}`) ?? 0)) : m.value;
    const spread = makeSpread({
      start: p.startDate,
      end: p.endDate,
      pauses: [],
      value: m.value,
      stopOn,
      final,
    });
    const plain = makeSpread({ start: p.startDate, end: p.endDate, pauses: [], value: m.value });
    if (spread.bad && !cancelled) badDates += 1;

    const lines = payoutsByPlan.get(p.id) ?? [];
    let shareValue: number;
    let shareFinal: number;
    if (lines.length > 0) {
      shareFinal = finalShare(lines);
      shareValue = 0;
      for (const l of lines) if (!l.adjustment) shareValue += fin(l.originalShare);
    } else {
      const live = ptBill.has(p.id) && !p.paidInOldSoftware;
      shareValue = shareFinal = live ? Math.max(0, fin(p.trainerShareAmount)) : 0;
    }
    const share = makeSpread({
      start: p.startDate,
      end: p.endDate,
      pauses: [],
      value: shareValue,
      stopOn,
      final: shareFinal,
    });
    return {
      kind: "pt",
      plan: p,
      id: p.id,
      clientId: p.clientId,
      trainerId: p.trainerId,
      label: p.packageName,
      listPrice: Math.max(0, fin(p.listPrice)),
      startDay,
      endDay,
      effEndDay: endDay,
      cancelled,
      superseded: false,
      old: p.paidInOldSoftware,
      value: m.value,
      paid: m.paid,
      paidEff: m.paid,
      spread,
      plain,
      share,
    };
  });

  /* ---- notes */
  if (badDates > 0) {
    notes.push(
      `${badDates} ${plural(badDates, "plan has", "plans have")} a missing or wrong end date; ${plural(badDates, "its", "their")} money is counted on the start day.`,
    );
  }
  if (missingBill > 0) {
    notes.push(
      `${missingBill} ${plural(missingBill, "plan has", "plans have")} no bill, so ${plural(missingBill, "it counts", "they count")} as ₹0.`,
    );
  }
  if (orphanBills > 0) {
    notes.push(
      `${orphanBills} ${plural(orphanBills, "bill belongs", "bills belong")} to plans that no longer exist; ${plural(orphanBills, "it is", "they are")} counted on the bill date.`,
    );
  }
  if (listPriced > 0) {
    notes.push(
      `${listPriced} ${plural(listPriced, "plan from", "plans from")} the old software or an import ${plural(listPriced, "is", "are")} valued at ${plural(listPriced, "its", "their")} list price.`,
    );
  }

  return { gym, pt, orphans, otherLines, notes };
}

/**
 * Does this member count as a "new member" when they join? Not when every plan they ever had came
 * from the old software or the CSV import (those people joined long before this app).
 */
export function countsAsNew(gym: GymEntry[], pt: PtEntry[]): boolean {
  if (gym.length + pt.length === 0) return true;
  const allOld =
    gym.every((e) => e.plan.paidInOldSoftware || e.plan.imported) &&
    pt.every((e) => e.plan.paidInOldSoftware);
  return !allOld;
}

export function groupByClient<T extends { clientId: string }>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of list) {
    const l = out.get(x.clientId);
    if (l) l.push(x);
    else out.set(x.clientId, [x]);
  }
  return out;
}
