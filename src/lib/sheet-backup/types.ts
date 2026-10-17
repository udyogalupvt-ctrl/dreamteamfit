/**
 * Plain shapes for the Google Sheet backup. The server turns Firestore documents into these
 * (Timestamps already become ISO strings / IST days) so the row builders stay pure: no database,
 * no React, relative imports only, unit-tested with `node --test`.
 */

/** One money movement (payments collection). */
export interface PayIn {
  id: string;
  clientId: string;
  clientNameSnapshot: string;
  invoiceId: string;
  membershipId: string | null;
  ptAssignmentId: string | null;
  amount: number;
  method: string;
  paymentDate: string;
  kind: "initial" | "balance" | "refund";
  counsellorName: string;
  oldSoftware?: boolean;
  oldSoftwareBillNo?: string;
  /** Two payment docs (Cash + UPI) with one splitId are one sale row. */
  splitId?: string;
  /** The IST day (YYYY-MM-DD) the payment was typed in. */
  createdDay: string;
}

/** A bill (invoices collection). */
export interface BillIn {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientNameSnapshot: string;
  /** The member's phone when the bill was made (kept when the member is deleted). */
  clientPhoneSnapshot?: string;
  membershipId: string | null;
  ptAssignmentId: string | null;
  items: { name: string }[];
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
  paymentMethod: string;
  invoiceDate: string;
  dueDate: string;
  membershipGross: number;
  ptGross: number;
  upgradeCredit?: number;
  oldSoftwareCredit?: number;
  cancelledParts?: Record<string, { kind: "gym" | "pt"; amount: number }> | null;
  /** false = an old bill with no payment records (money counts on the bill date). */
  paymentsTracked?: boolean;
  counsellorName: string;
  createdDay: string;
}

/** A gym plan (memberships collection). */
export interface PlanIn {
  id: string;
  clientId: string;
  packageId: string;
  packageNameSnapshot: string;
  priceSnapshot: number;
  durationDaysSnapshot: number;
  startDate: string;
  endDate: string;
  status: string;
  counsellorName: string;
  /** The bill the plan was sold on (All plans tab). */
  invoiceId?: string;
  paidInOldSoftware?: boolean;
  oldSoftwarePaid?: number;
  oldSoftwareBalance?: number;
}

/** A personal-training plan (ptAssignments collection). */
export interface PtIn {
  id: string;
  clientId: string;
  ptPackageNameSnapshot: string;
  trainerNameSnapshot: string;
  startDate: string;
  endDate: string;
  status: string;
  ptPrice: number;
  /** The bill the PT plan was sold on (All plans tab). */
  invoiceId?: string;
  paidInOldSoftware?: boolean;
  oldSoftwarePaid?: number;
}

export interface ClientIn {
  id: string;
  clientCode: string;
  fullName: string;
  phone: string;
}

export interface PackageIn {
  id: string;
  name: string;
  category: string;
  durationDays: number;
  price: number;
  isActive: boolean;
}

/** One sheet cell: text, number, or a formula string starting with "=". */
export type Cell = string | number;

/**
 * One sheet column. `value` is a method (not an arrow property) so a Column<MonthRow> also fits a
 * Column<unknown> in the formatter. Date columns return an ISO "YYYY-MM-DD" (or ""), which
 * toCells turns into a real date; money columns return numbers (0 is shown as empty).
 */
export interface Column<R> {
  header: string;
  value(r: R, i: number): Cell;
  /** Pixels. Columns have fixed widths, the sheet never auto-resizes. */
  width: number;
  kind?: "date" | "money" | "text" | "number";
  /** Totals row: "sum" = SUM formula, "due" = the due on the distinct bills. */
  money?: "sum" | "due";
  /** Text colour of the column's cells (the mode columns). */
  color?: string;
}
