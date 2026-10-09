/**
 * Money lists (Dashboard "Collected"): a payment and the refund that gave the same money back
 * (same member, same amount, same mode) cancel out. They are folded away from the list so it
 * shows the money that really came in; the totals are unchanged (the pair adds up to ₹0, also per
 * payment mode). A refund in another mode than the payment is not folded: it really changed that
 * mode's money (e.g. UPI in, cash out of the drawer).
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

export interface PairRow {
  id: string;
  clientId: string;
  amount: number;
  method: string;
  kind: string;
  bill: string;
  at: Date;
}

const cents = (n: number) => Math.round(n * 100);

export function foldTakenBack<T extends PairRow>(rows: T[]): { shown: T[]; folded: [T, T][] } {
  const used = new Set<string>();
  const folded: [T, T][] = [];
  const refunds = rows
    .filter((r) => r.kind === "refund" && r.amount < 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const back of refunds) {
    const match = rows
      .filter(
        (r) =>
          !used.has(r.id) &&
          r.id !== back.id &&
          r.amount > 0 &&
          r.kind !== "refund" &&
          r.kind !== "old" &&
          r.clientId === back.clientId &&
          r.method === back.method &&
          cents(r.amount) === cents(-back.amount) &&
          r.at.getTime() <= back.at.getTime(),
      )
      // The same bill first, then the latest payment before the refund.
      .sort(
        (a, b) =>
          Number(b.bill === back.bill) - Number(a.bill === back.bill) ||
          b.at.getTime() - a.at.getTime(),
      )[0];
    if (!match) continue;
    used.add(match.id);
    used.add(back.id);
    folded.push([match, back]);
  }
  return { shown: rows.filter((r) => !used.has(r.id)), folded };
}
