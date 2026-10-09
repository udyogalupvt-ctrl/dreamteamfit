import { formatPrice } from "@/lib/format";
import { planMoney, type PlanBill, type PlanMoney } from "@/lib/plan-money";

type Bill = (PlanBill & { oldSoftwareCredit?: number | undefined }) | null | undefined;

/** How the plan's amount was reached: "package ₹1,999 · ₹300 discount". */
function breakdown(m: PlanMoney, bill: NonNullable<Bill>) {
  return [
    `package ${formatPrice(m.price)}`,
    m.discount ? `${formatPrice(m.discount)} discount` : "",
    m.credit
      ? `${formatPrice(m.credit)} ${bill.oldSoftwareCredit ? "paid in the old software" : "upgrade credit"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The plan card's money line: what the member pays for the plan (its bill, after discount), and
 * what is still due. Without a bill: the package price.
 */
export function PlanPriceLine({
  kind,
  price,
  bill,
  ownDiscount = 0,
}: {
  kind: "gym" | "pt";
  price: number;
  bill: Bill;
  /** ₹ off this plan alone (a PT discount; `price` is after it). */
  ownDiscount?: number | undefined;
}) {
  const m = planMoney(kind, price, bill, ownDiscount);
  if (!m || !bill)
    return (
      <p className="text-sm">
        Price <span className="font-semibold tabular-nums">{formatPrice(price)}</span>
      </p>
    );
  return (
    <p className="text-sm">
      {m.due > 0 ? (
        <>
          Paid <span className="font-semibold tabular-nums">{formatPrice(m.paid)}</span> of{" "}
          <span className="tabular-nums">{formatPrice(m.total)}</span> ·{" "}
          <span className="font-semibold tabular-nums">{formatPrice(m.due)} due</span>
        </>
      ) : (
        <>
          Paid <span className="font-semibold tabular-nums">{formatPrice(m.total)}</span>
        </>
      )}
      {m.total !== m.price ? (
        <span className="text-meta block tabular-nums">{breakdown(m, bill)}</span>
      ) : null}
    </p>
  );
}

/** A history row's amount: what the member pays for the plan, with how it was reached. */
export function PlanPriceAmount({
  kind,
  price,
  bill,
  ownDiscount = 0,
}: {
  kind: "gym" | "pt";
  price: number;
  bill: Bill;
  /** ₹ off this plan alone (a PT discount; `price` is after it). */
  ownDiscount?: number | undefined;
}) {
  const m = planMoney(kind, price, bill, ownDiscount);
  if (!m || !bill || (m.total === m.price && !m.due))
    return <span className="font-semibold tabular-nums">{formatPrice(price)}</span>;
  return (
    <span className="text-right">
      <span className="block font-semibold tabular-nums">{formatPrice(m.total)}</span>
      <span className="text-meta block tabular-nums">
        {[m.due ? `${formatPrice(m.due)} due` : "", m.total !== m.price ? breakdown(m, bill) : ""]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

/** The plan's own money in a sentence (PT details): "₹1,699 (package ₹1,999 · ₹300 discount)". */
export function PlanPriceText({
  kind,
  price,
  bill,
  ownDiscount = 0,
}: {
  kind: "gym" | "pt";
  price: number;
  bill: Bill;
  /** ₹ off this plan alone (a PT discount; `price` is after it). */
  ownDiscount?: number | undefined;
}) {
  const m = planMoney(kind, price, bill, ownDiscount);
  return (
    <>
      {!m || !bill || m.total === m.price
        ? formatPrice(price)
        : `${formatPrice(m.total)} (${breakdown(m, bill)})`}
    </>
  );
}
