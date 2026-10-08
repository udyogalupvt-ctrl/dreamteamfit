/**
 * Money for a plan that was typed in after the plan had started. The user's rule (2026-10-09):
 * "we don't know when he paid, so count it on the plan's first day". A sale saved on 8 Oct for a
 * plan that runs 2 Oct → 1 Nov counts in Collected on 2 Oct, not on 8 Oct.
 *
 * - New sales: the joining / renewal checkout dates its payment on the plan's first day (staff can
 *   pick "Paid today" instead). Not an upgrade: that money is paid when the upgrade is made.
 * - Sales saved before: the owner's tool (Income & expenses) moves each joining payment to its
 *   plan's first day, exactly like the owner's own "change the payment date" correction, with Undo.
 *
 * Money moves only inside the Day Book's open days (from the 1st of last month, `openFrom`): cash
 * in the drawer today stays the same; only the day it came in changes. One exception is kept out:
 * cash moved to before a day whose opening cash was typed in (the Day Book's first day) would
 * vanish from the drawer, so that cash stays in the Day Book on the day it was typed in
 * (`cashOn`) while Collected counts it on the plan's first day.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Marks the correction line the owner's tool writes (an edit made by hand has none). */
export const LATE_TOOL = "late-sale-dates";

/**
 * The day a checkout's money counts on: the plan's first day when the plan started before today
 * (and the Day Book still has that day open), else today.
 */
export function saleMoneyDay(input: {
  startDate: string;
  today: string;
  /** The first day money may be put on (the 1st of last month). */
  openFrom: string;
  /** Upgrades are paid when they are made. */
  upgrade: boolean;
  /** Staff said the member paid today. */
  paidToday: boolean;
}): string {
  const { startDate: start, today } = input;
  if (input.upgrade || input.paidToday || !ISO.test(start)) return today;
  return start < today && start >= input.openFrom ? start : today;
}

/** A payment's corrections: did someone set its date by hand (not this tool)? */
export function dateSetByHand(
  edits: readonly { changes?: readonly string[]; tool?: string | undefined }[] | undefined,
) {
  return (edits ?? []).some(
    (e) => e.tool !== LATE_TOOL && (e.changes ?? []).some((c) => c.startsWith("Date ")),
  );
}

/** One joining payment, with what the tool needs to know about its plan and bill. */
export interface LateSaleFact {
  paymentId: string;
  clientId: string;
  clientName: string;
  /** What it paid for ("1 month strengthening", "+ PT: …"). */
  plan: string;
  /** The plan's first day (the gym plan's; a PT-only sale: the PT plan's). "" = not found. */
  startDate: string;
  planStatus: string;
  paidInOldSoftware: boolean;
  paymentDate: string;
  amount: number;
  method: string;
  kind: string;
  oldSoftware: boolean;
  invoiceId: string;
  invoiceNumber: string;
  /** The bill's payment status; "missing" = the bill is gone. */
  billStatus: string;
  upgradeCredit: number;
  /**
   * Its day was already chosen: set by hand (Edit payment), or staff said at the checkout that
   * the member paid that day. Theirs stays.
   */
  dateSetByHand: boolean;
}

export type LateSkipReason =
  "before-open" | "cancelled" | "upgrade" | "date-set" | "bill-closed" | "old-software";

export interface LateMove {
  paymentId: string;
  clientId: string;
  clientName: string;
  plan: string;
  invoiceNumber: string;
  amount: number;
  method: string;
  /** The day it was typed in (counted now) → the plan's first day. */
  from: string;
  to: string;
  /** Cash that stays in the Day Book drawer on this day (= `from`): see the note at the top. */
  cashOn?: string;
}

export interface LateSkip extends Omit<LateMove, "to" | "cashOn"> {
  start: string;
  reason: LateSkipReason;
}

export interface LatePlan {
  move: LateMove[];
  skipped: LateSkip[];
  total: number;
  /** Months whose totals change (money leaving one month for the one the plan started in). */
  months: { month: string; change: number }[];
}

/**
 * Which joining payments were typed in after their plan started, and where each one goes. Balance
 * payments are left alone (they were paid on their own day), and so is everything in the list of
 * reasons in `LateSkipReason`.
 */
export function planLateSales(
  facts: LateSaleFact[],
  openFrom: string,
  /** Days whose opening cash was typed in the Day Book (the drawer restarts there). */
  openingDays: readonly string[] = [],
): LatePlan {
  const move: LateMove[] = [];
  const skipped: LateSkip[] = [];
  for (const f of facts) {
    if (f.kind !== "initial" || !(f.amount > 0) || f.oldSoftware || !f.invoiceId) continue;
    if (!ISO.test(f.startDate) || !ISO.test(f.paymentDate) || f.startDate >= f.paymentDate)
      continue;
    const row = {
      paymentId: f.paymentId,
      clientId: f.clientId,
      clientName: f.clientName,
      plan: f.plan,
      invoiceNumber: f.invoiceNumber,
      amount: round(f.amount),
      method: f.method,
      from: f.paymentDate,
    };
    const reason: LateSkipReason | null = f.paidInOldSoftware
      ? "old-software"
      : f.planStatus === "cancelled"
        ? "cancelled"
        : f.upgradeCredit > 0
          ? "upgrade"
          : ["closed", "refunded", "missing"].includes(f.billStatus)
            ? "bill-closed"
            : f.dateSetByHand
              ? "date-set"
              : f.startDate < openFrom || f.paymentDate < openFrom
                ? "before-open"
                : null;
    if (reason) skipped.push({ ...row, start: f.startDate, reason });
    else {
      const crosses =
        f.method === "Cash" && openingDays.some((o) => o > f.startDate && o <= f.paymentDate);
      move.push({ ...row, to: f.startDate, ...(crosses ? { cashOn: f.paymentDate } : {}) });
    }
  }
  move.sort((a, b) => b.from.localeCompare(a.from) || a.clientName.localeCompare(b.clientName));
  return {
    move,
    skipped,
    total: round(move.reduce((n, m) => n + m.amount, 0)),
    months: monthChanges(move),
  };
}

/** How each month's total changes when these payments move (only months that change). */
export function monthChanges(moves: readonly Pick<LateMove, "from" | "to" | "amount">[]) {
  const months = new Map<string, number>();
  for (const m of moves) {
    const a = m.from.slice(0, 7);
    const b = m.to.slice(0, 7);
    if (a === b) continue;
    months.set(a, round((months.get(a) ?? 0) - m.amount));
    months.set(b, round((months.get(b) ?? 0) + m.amount));
  }
  return [...months.entries()]
    .filter(([, change]) => change !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, change]) => ({ month, change }));
}

/** Undo of a run: only payments still on the day the run put them (nobody changed them since). */
export function lateUndoable(
  item: { paymentId: string; from: string; to: string },
  now: { paymentDate: string; amount: number } | null,
) {
  return !!now && now.paymentDate === item.to && now.amount > 0;
}
