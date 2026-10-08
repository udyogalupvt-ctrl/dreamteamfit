/**
 * What a plan really costs the member, from its bill: the package price less the plan's share of
 * the bill's discount, less any credit (unused days of an upgraded plan, money paid in the old
 * software), and what is paid and still due. A bill with a gym plan and PT shares its discount,
 * credit, tax and payments by price, like the payment split. The member page and the member app
 * show this, so a plan reads ₹1,699 (package ₹1,999 − ₹300 discount), as in the money lists.
 *
 * Pure maths only (no database): relative imports, unit-tested with `node --test`.
 */

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PlanBill {
  subtotal: number;
  /** Staff discount + credits (credits are kept inside the discount). */
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  membershipGross: number;
  ptGross: number;
  upgradeCredit?: number | undefined;
  oldSoftwareCredit?: number | undefined;
}

export interface PlanMoney {
  /** The package price on the bill. */
  price: number;
  /** The staff discount on this plan (its share of the bill's). */
  discount: number;
  /** Credit from an upgraded plan / the old software (its share). */
  credit: number;
  /** price − discount: what the plan was sold for. */
  value: number;
  /** What the member pays for it on this bill (after discount and credit, with any tax). */
  total: number;
  paid: number;
  due: number;
  /** The bill also has another plan: these are this plan's share. */
  shared: boolean;
}

/** The plan's money on its bill; null when there is no bill to read it from. */
export function planMoney(
  kind: "gym" | "pt",
  price: number,
  bill: PlanBill | null | undefined,
): PlanMoney | null {
  if (!bill || !(bill.subtotal > 0)) return null;
  const gross = Math.max(0, (kind === "gym" ? bill.membershipGross : bill.ptGross) || price);
  const ratio = Math.min(gross, bill.subtotal) / bill.subtotal;
  const credits =
    Math.max(0, Number(bill.upgradeCredit) || 0) + Math.max(0, Number(bill.oldSoftwareCredit) || 0);
  const discountAll = Math.max(0, bill.discount);
  const discount = round(Math.max(0, discountAll - credits) * ratio);
  const total = round(Math.max(0, bill.total) * ratio);
  return {
    price: round(gross),
    discount,
    credit: round(Math.min(credits, discountAll) * ratio),
    value: round(Math.max(0, gross - discount)),
    total,
    paid: round(Math.max(0, bill.amountPaid) * ratio),
    due: round(Math.max(0, bill.balanceDue) * ratio),
    shared: ratio < 1,
  };
}

/**
 * What the member paid for a plan, for crediting its unused days on an upgrade: the price less its
 * discount; a plan carried over from the old software (its bill here is only the balance): what it
 * cost there (paid + balance); no bill: the package price. A sale here later marked "paid in the
 * old software" keeps the whole plan on its bill (the old money is a credit on it): its bill counts.
 */
export function planSoldFor(
  kind: "gym" | "pt",
  plan: {
    price: number;
    paidInOldSoftware?: boolean | undefined;
    oldSoftwarePaid?: number | undefined;
    oldSoftwareBalance?: number | undefined;
  },
  bill: PlanBill | null | undefined,
) {
  const movedFromHere = bill && (Number(bill.oldSoftwareCredit) || 0) > 0;
  if (plan.paidInOldSoftware && !movedFromHere) {
    const there =
      Math.max(0, Number(plan.oldSoftwarePaid) || 0) +
      Math.max(0, Number(plan.oldSoftwareBalance) || 0);
    return there > 0 ? round(there) : Math.max(0, plan.price);
  }
  return planMoney(kind, plan.price, bill)?.value ?? Math.max(0, plan.price);
}
