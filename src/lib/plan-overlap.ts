/**
 * Two gym plans of one member for the same days: usually a copy (an old plan added twice, or a plan
 * sold here that the old software already had), and both count their money. A sale or an edit that
 * would make one is refused; the owner's list "Plans that overlap" shows the ones already saved.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

export interface OverlapPlan {
  id: string;
  clientId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  paidInOldSoftware: boolean;
  /** The renewal that ended it ("" = none). */
  endedBy: string;
  /** The upgrade that cut it short ("" = none). */
  upgradedTo: string;
  /** When it was made and last changed (ms, 0 = not known). */
  createdMs: number;
  updatedMs: number;
  /** Plans the owner checked: not a copy of this one. */
  overlapOk: string[];
}

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Days both plans cover (0 = none). */
export function overlapDays(
  a: Pick<OverlapPlan, "startDate" | "endDate">,
  b: Pick<OverlapPlan, "startDate" | "endDate">,
): number {
  const from = a.startDate > b.startDate ? a.startDate : b.startDate;
  const to = a.endDate < b.endDate ? a.endDate : b.endDate;
  if (!from || !to || to < from) return 0;
  return Math.round((ms(to) - ms(from)) / DAY) + 1;
}

/**
 * A plan a new plan must not share days with: not cancelled, not ended by a renewal (stamped), and
 * not ended before its own end date (an older-style renewal or upgrade ended it on purpose).
 */
const counts = (p: OverlapPlan, today: string) =>
  p.status !== "cancelled" && !p.endedBy && !(p.status === "expired" && p.endDate >= today);

/** The member's plan that a new (or edited) gym plan would overlap, or null. */
export function overlapConflict(
  plan: { startDate: string; endDate: string },
  others: OverlapPlan[],
  today: string,
  ignoreIds: string[] = [],
): OverlapPlan | null {
  return (
    others
      .filter((o) => !ignoreIds.includes(o.id) && counts(o, today) && overlapDays(plan, o) > 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};

/** Why a sale / edit was refused, and what to do instead. */
export function conflictMessage(other: OverlapPlan): string {
  return (
    `This member already has ${other.name} from ${nice(other.startDate)} to ${nice(other.endDate)}` +
    `${other.paidInOldSoftware ? " (paid in the old software)" : ""}, and these dates overlap it. ` +
    "If that plan is a copy, remove it first (bin icon on the member's page); if its dates are wrong, fix them with Edit plan."
  );
}

export interface OverlapPair {
  clientId: string;
  a: OverlapPlan;
  b: OverlapPlan;
  days: number;
}

/**
 * One member's (or many members') plans → the pairs that share days and are both counted. Left out:
 * cancelled plans, a plan a renewal or upgrade ended (stamped, or ended in the same write that made
 * the other plan), and pairs the owner marked "Not a duplicate".
 */
export function overlapPairs(plans: OverlapPlan[]): OverlapPair[] {
  const byClient = new Map<string, OverlapPlan[]>();
  for (const p of plans)
    if (p.status !== "cancelled" && p.clientId)
      byClient.set(p.clientId, [...(byClient.get(p.clientId) ?? []), p]);
  const out: OverlapPair[] = [];
  const endedByOther = (x: OverlapPlan, y: OverlapPlan) =>
    x.endedBy === y.id ||
    x.upgradedTo === y.id ||
    (x.status === "expired" && x.updatedMs > 0 && x.updatedMs === y.createdMs);
  for (const [clientId, list] of byClient) {
    const sorted = [...list].sort(
      (x, y) => x.startDate.localeCompare(y.startDate) || x.id.localeCompare(y.id),
    );
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const days = overlapDays(a, b);
        if (days <= 0) continue;
        if (endedByOther(a, b) || endedByOther(b, a)) continue;
        if (a.overlapOk.includes(b.id) || b.overlapOk.includes(a.id)) continue;
        out.push({ clientId, a, b, days });
      }
  }
  return out.sort((x, y) => y.days - x.days || x.clientId.localeCompare(y.clientId));
}

/** A plan document's fields for the checks above. */
export function overlapPlan(id: string, d: Record<string, unknown>): OverlapPlan {
  const msOf = (v: unknown) => {
    const t = v as { toMillis?: () => number; toDate?: () => Date } | null | undefined;
    return t?.toMillis?.() ?? t?.toDate?.().getTime() ?? 0;
  };
  return {
    id,
    clientId: String(d["clientId"] ?? ""),
    name: String(d["packageNameSnapshot"] ?? ""),
    startDate: String(d["startDate"] ?? ""),
    endDate: String(d["endDate"] ?? ""),
    status: String(d["status"] ?? ""),
    paidInOldSoftware: d["paidInOldSoftware"] === true,
    endedBy: String(d["endedBy"] ?? ""),
    upgradedTo: String(d["upgradedTo"] ?? ""),
    createdMs: msOf(d["createdAt"]),
    updatedMs: msOf(d["updatedAt"]),
    overlapOk: Array.isArray(d["overlapOk"]) ? (d["overlapOk"] as unknown[]).map(String) : [],
  };
}

/** Income & expenses → "Plans that overlap": one plan of a pair, as the owner sees it. */
export interface OverlapListPlan {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  paidInOldSoftware: boolean;
  /** Paid in the old software (₹), for an old plan. */
  oldPaid: number;
  invoiceId: string;
}

export interface OverlapListRow {
  clientId: string;
  clientName: string;
  clientCode: string;
  days: number;
  a: OverlapListPlan;
  b: OverlapListPlan;
}
