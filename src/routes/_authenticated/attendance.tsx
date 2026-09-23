import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — REBUILD FITNESS" },
      { name: "description", content: "Check-ins, batch tracking and biometric sync." },
      { property: "og:title", content: "Attendance — REBUILD FITNESS" },
      { property: "og:description", content: "Check-ins, batch tracking and biometric sync." },
    ],
  }),
  component: () => (
    <ModulePlaceholder
      title="Attendance"
      description="Floor activity, batch occupancy and member consistency."
      icon={CalendarCheck}
      capabilities={[
        "Manual and biometric check-in capture",
        "Batch-wise and hourly occupancy",
        "Inactive member detection",
        "Trainer session attendance",
      ]}
    />
  ),
});
