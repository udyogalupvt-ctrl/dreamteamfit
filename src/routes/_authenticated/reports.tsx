import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — REBUILD FITNESS" },
      { name: "description", content: "Revenue, retention and performance reporting." },
      { property: "og:title", content: "Reports — REBUILD FITNESS" },
      { property: "og:description", content: "Revenue, retention and performance reporting." },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Reports"
      description="Decision-grade reporting for owners and branch managers."
      icon={BarChart3}
      capabilities={[
        "Revenue and collection reports",
        "Retention, churn and renewal analytics",
        "Staff and trainer performance",
        "Exportable CSV and PDF summaries",
      ]}
    />
  ),
});
