import {
  Salad,
  BarChart3,
  CalendarCheck,
  CreditCard,
  Dumbbell,
  ReceiptIndianRupee,
  LayoutDashboard,
  Cake,
  Package,
  Settings,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import type { NavItem } from "@/types";

export const APP_NAME = "REBUILD FITNESS";
export const APP_TAGLINE = "Gym Management";
export const GYM_NAME = "REBUILD FITNESS";
export const CLOUDINARY_CLIENT_FOLDER = "rebuild-fitness/clients";
export const CLOUDINARY_BRAND_FOLDER = "rebuild-fitness/branding";

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, group: "Workspace" },
  { label: "Clients", to: "/clients", icon: Users, group: "Workspace" },
  { label: "Billing & Payments", to: "/billing", icon: CreditCard, group: "Workspace" },
  { label: "Leads & Follow-ups", to: "/leads", icon: UserPlus, group: "Workspace" },
  { label: "Packages", to: "/packages", icon: Package, group: "Workspace" },
  { label: "Attendance", to: "/attendance", icon: CalendarCheck, group: "Workspace" },
  {
    label: "Sessions & Classes", to: "/pt-sessions", icon: UsersRound, group: "Workspace",
    children: [
      { label: "PT Sessions", to: "/pt-sessions" },
      { label: "Group Classes", to: "/group-classes" },
      { label: "Bookings", to: "/bookings" },
    ],
  },
  { label: "Birthdays", to: "/birthdays", icon: Cake, group: "Workspace" },
  { label: "Expenses", to: "/expenses", icon: ReceiptIndianRupee, group: "Workspace" },
  { label: "Reports", to: "/reports", icon: BarChart3, group: "Workspace" },
  { label: "Workout Plans", to: "/workout-plans", icon: Dumbbell, group: "Workspace" },
  { label: "Diet Plans", to: "/diet-plans", icon: Salad, group: "Workspace" },
  { label: "Settings", to: "/settings", icon: Settings, group: "Management" },
];

/** Primary destinations surfaced in the mobile bottom bar. */
export const MOBILE_NAV_PATHS = ["/dashboard", "/clients", "/attendance", "/billing"];
