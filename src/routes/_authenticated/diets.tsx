import { createFileRoute } from "@tanstack/react-router";
import { Apple } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/diets")({
  head: () => ({
    meta: [{ title: "Diet Plans — REBUILD FITNESS" }],
  }),
  component: DietsPage,
});

function DietsPage() {
  return (
    <ModulePlaceholder
      title="Diet Plans"
      description="Create nutritional guides and meal plans tailored to client goals."
      icon={Apple}
      capabilities={[
        "Meal plan creation",
        "Macro & calorie calculations",
        "Supplement recommendations",
        "Food database integration",
        "Goal-based plan templates",
      ]}
    />
  );
}
