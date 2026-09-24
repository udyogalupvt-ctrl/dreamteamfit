import { useNavigate } from "@tanstack/react-router";
import {
  CalendarPlus,
  CreditCard,
  Phone,
  ReceiptIndianRupee,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { useAccess } from "@/hooks/use-access";
import type { StaffFeature } from "@/types/models";

export interface QuickAction {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
  feature: StaffFeature;
}

/** The front-desk shortcuts, defined once for the dashboard, top bar and mobile "+" button. */
export function useQuickActions(): QuickAction[] {
  const navigate = useNavigate();
  const { openEnrollment } = useEnrollment();
  const { can } = useAccess();
  const all: QuickAction[] = [
    {
      id: "member",
      feature: "members",
      label: "New member",
      hint: "Details, payment, bill, thumb",
      icon: Users,
      run: () => openEnrollment(),
    },
    {
      id: "inquiry",
      feature: "leads",
      label: "New inquiry",
      hint: "Someone visited or called",
      icon: UserPlus,
      run: () => void navigate({ to: "/leads", search: { new: true } }),
    },
    {
      id: "calls",
      feature: "leads",
      label: "Calls to make",
      hint: "Today's follow-ups",
      icon: Phone,
      run: () => void navigate({ to: "/leads", search: { tab: "followups" } }),
    },
    {
      id: "bill",
      feature: "billing",
      label: "New bill",
      hint: "Renewal or shop items",
      icon: CreditCard,
      run: () => void navigate({ to: "/billing", search: { create: true } }),
    },
    {
      id: "expense",
      feature: "daybook",
      label: "Add expense",
      hint: "Rent, salary, bills…",
      icon: ReceiptIndianRupee,
      run: () => void navigate({ to: "/day-book", search: { add: "expense" } }),
    },
    {
      id: "booking",
      feature: "classes",
      label: "Book PT / class",
      hint: "Schedule a session",
      icon: CalendarPlus,
      run: () => void navigate({ to: "/bookings", search: { create: true } }),
    },
  ];
  return all.filter((a) => can(a.feature));
}
