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

export interface QuickAction {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

/** The front-desk shortcuts, defined once for the dashboard, top bar and mobile "+" button. */
export function useQuickActions(): QuickAction[] {
  const navigate = useNavigate();
  const { openEnrollment } = useEnrollment();
  return [
    {
      id: "member",
      label: "New member",
      hint: "Details, payment, bill, thumb",
      icon: Users,
      run: () => openEnrollment(),
    },
    {
      id: "inquiry",
      label: "New inquiry",
      hint: "Someone visited or called",
      icon: UserPlus,
      run: () => void navigate({ to: "/leads", search: { new: true } }),
    },
    {
      id: "calls",
      label: "Calls to make",
      hint: "Today's follow-ups",
      icon: Phone,
      run: () => void navigate({ to: "/leads", search: { tab: "followups" } }),
    },
    {
      id: "bill",
      label: "New bill",
      hint: "Renewal or shop items",
      icon: CreditCard,
      run: () => void navigate({ to: "/billing", search: { create: true } }),
    },
    {
      id: "expense",
      label: "Add expense",
      hint: "Rent, salary, bills…",
      icon: ReceiptIndianRupee,
      run: () => void navigate({ to: "/expenses", search: { create: true } }),
    },
    {
      id: "booking",
      label: "Book PT / class",
      hint: "Schedule a session",
      icon: CalendarPlus,
      run: () => void navigate({ to: "/bookings", search: { create: true } }),
    },
  ];
}
