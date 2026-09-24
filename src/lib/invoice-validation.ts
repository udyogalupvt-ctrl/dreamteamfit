import { z } from "zod";
import { PAYMENT_METHODS } from "@/types/models";

export const invoiceItemSchema = z.object({
  name: z.string().trim().min(1, "Item name is required").max(120),
  description: z.string().trim().max(500),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(1000),
  unitPrice: z.coerce.number().min(0, "Price cannot be negative").max(100_000_000),
  packageId: z.string().nullable(),
});

export const createInvoiceSchema = z.object({
  clientId: z.string().min(1, "Select a member"),
  items: z.array(invoiceItemSchema).min(1, "Add at least one item").max(100),
  discount: z.coerce.number().min(0, "Discount cannot be negative").max(100_000_000),
  amountPaid: z.coerce.number().min(0, "Amount paid cannot be negative").max(100_000_000),
  paymentMethod: z.enum(PAYMENT_METHODS),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid invoice date"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid due date"),
  notes: z.string().trim().max(1000),
  createMembership: z.boolean(),
  membershipStartDate: z.string(),
  previousAction: z.enum(["expired", "cancelled"]),
}).superRefine((value, ctx) => {
  const subtotal = value.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (value.discount > subtotal) ctx.addIssue({ code: "custom", path: ["discount"], message: "Discount cannot exceed subtotal" });
  if (value.dueDate < value.invoiceDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date cannot be before invoice date" });
  if (value.createMembership && !value.items.some((item) => item.packageId)) ctx.addIssue({ code: "custom", path: ["items"], message: "Select a package to create a membership" });
});

export const businessBillingSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(120),
  logoUrl: z.string().trim().max(1000),
  address: z.string().trim().max(500),
  phone: z.string().trim().max(30),
  email: z.string().trim().max(255).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
  gstin: z.string().trim().max(30),
  taxEnabled: z.boolean(),
  taxRate: z.coerce.number().min(0, "Tax cannot be negative").max(100, "Tax cannot exceed 100%"),
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,12}$/, "Use 1–12 uppercase letters, numbers or hyphens"),
  currency: z.literal("INR"),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;