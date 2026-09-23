import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareHeart } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({
    meta: [
      { title: "Follow-ups — FORGE" },
      { name: "description", content: "Renewal reminders, win-backs and staff task pipelines." },
      { property: "og:title", content: "Follow-ups — FORGE" },
      {
        property: "og:description",
        content: "Renewal reminders, win-backs and staff task pipelines.",
      },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Follow-ups"
      description="Never lose a renewal, trial or win-back conversation again."
      icon={MessageSquareHeart}
      capabilities={[
        "Task pipeline with due dates and owners",
        "Renewal and expiry reminder queues",
        "Call outcomes and notes timeline",
        "Automation hooks for later stages",
      ]}
    />
  ),
});
