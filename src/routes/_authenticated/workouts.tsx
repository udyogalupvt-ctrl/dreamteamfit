import { createFileRoute } from "@tanstack/react-router";
import { Dumbbell } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/workouts")({
  head: () => ({
    meta: [{ title: "Workout Plans — REBUILD FITNESS" }],
  }),
  component: WorkoutsPage,
});

function WorkoutsPage() {
  return (
    <ModulePlaceholder
      title="Workout Plans"
      description="Design and assign customized training routines for your clients."
      icon={Dumbbell}
      capabilities={[
        "Exercise library management",
        "Custom routine builder",
        "Client plan assignments",
        "Progress tracking & PR logs",
        "Template saving & reuse",
      ]}
    />
  );
}
