import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/inquiries")({
  head: () => ({
    meta: [
      { title: "Inquiries — FORGE" },
      { name: "description", content: "Capture, assign and convert gym membership inquiries." },
      { property: "og:title", content: "Inquiries — FORGE" },
      {
        property: "og:description",
        content: "Capture, assign and convert gym membership inquiries.",
      },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Inquiries"
      description="Walk-in, call and online leads with assignment and conversion tracking."
      icon={UserPlus}
      capabilities={[
        "Lead capture form with source tracking",
        "Assign inquiries to staff members",
        "Trial booking and gym tour scheduling",
        "Conversion funnel and lost-reason analytics",
      ]}
    />
  ),
});
