import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({
    meta: [
      { title: "Clients — FORGE" },
      { name: "description", content: "Member profiles, memberships, documents and history." },
      { property: "og:title", content: "Clients — FORGE" },
      {
        property: "og:description",
        content: "Member profiles, memberships, documents and history.",
      },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Clients"
      description="The single source of truth for every member in your gym."
      icon={Users}
      capabilities={[
        "Member profiles with Cloudinary photos",
        "Active, expired and frozen membership states",
        "Package history and payment ledger",
        "Body measurements and trainer notes",
      ]}
    />
  ),
});
