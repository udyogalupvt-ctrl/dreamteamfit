import { z } from "zod";
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS } from "@/types/models";

export const expenseSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Expense title is required")
      .max(120, "Keep the title under 120 characters"),
    // A built-in category or a custom one typed by the gym.
    category: z
      .string()
      .trim()
      .min(1, "Choose or type a category")
      .max(40, "Keep the category under 40 characters"),
    amount: z.coerce
      .number()
      .positive("Amount must be greater than 0")
      .max(100_000_000, "Amount is too large"),
    paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS, { message: "Payment method is required" }),
    date: z
      .string()
      .min(1, "Date is required")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
    description: z.string().trim().max(1000, "Keep the description under 1,000 characters"),
    notes: z.string().trim().max(1000, "Keep notes under 1,000 characters"),
    paidBy: z.string().trim().min(1, "Who paid?").max(60, "Keep the name short"),
    settled: z.boolean(),
    settledDate: z.string(),
    settledMethod: z.string(),
  })
  .transform((v) =>
    isGym(v.paidBy)
      ? { ...v, paidBy: "Gym", settled: true, settledDate: "", settledMethod: "" }
      : v,
  );

/** The dropdown: built-in categories ("Other" replaced by Custom…), then custom ones used before. */
export function expenseCategoryOptions(used: string[], current = "") {
  const builtIn = EXPENSE_CATEGORIES.filter((c) => c !== "Other") as string[];
  const known = new Set(builtIn.map((c) => c.toLowerCase()));
  const custom = [...new Set([...used, current].map((c) => c.trim()).filter(Boolean))]
    .filter((c) => !known.has(c.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...builtIn, ...custom];
}

/** "Gym" = paid from the gym's own cash or account. */
export const isGym = (paidBy: string) => !paidBy.trim() || paidBy.trim().toLowerCase() === "gym";

export type ExpenseFormValues = z.input<typeof expenseSchema>;
