import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Billing & Payments — FORGE" },
      { name: "description", content: "POS billing, invoices, dues and collection tracking." },
      { property: "og:title", content: "Billing & Payments — FORGE" },
      {
        property: "og:description",
        content: "POS billing, invoices, dues and collection tracking.",
      },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Billing & Payments"
      description="Collections, invoices and outstanding dues in one place."
      icon={CreditCard}
      capabilities={[
        "POS bill creation with taxes and discounts",
        "Invoice PDFs and receipt numbering",
        "Part payments, dues and refunds",
        "Daily collection reconciliation",
      ]}
    />
  ),
});
