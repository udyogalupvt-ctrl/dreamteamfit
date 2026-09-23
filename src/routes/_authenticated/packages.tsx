import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/packages")({
  head: () => ({
    meta: [
      { title: "Packages — FORGE" },
      { name: "description", content: "Membership plans, pricing tiers and add-on services." },
      { property: "og:title", content: "Packages — FORGE" },
      {
        property: "og:description",
        content: "Membership plans, pricing tiers and add-on services.",
      },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Packages"
      description="Design the membership plans your front desk sells every day."
      icon={Package}
      capabilities={[
        "Duration-based and session-based plans",
        "Personal training and add-on services",
        "Discount rules and promotional pricing",
        "Plan performance comparison",
      ]}
    />
  ),
});
