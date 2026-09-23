import {
  BarChart3,
  Bell,
  Cake,
  CalendarCheck,
  CalendarClock,
  CreditCard,
  Dumbbell,
  Fingerprint,
  History,
  LayoutDashboard,
  Package,
  ReceiptIndianRupee,
  Salad,
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

/**
 * Workspace = what the front desk uses every day. Everything else lives under one
 * collapsible "More" group so the sidebar stays short.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, group: "Workspace" },
  { label: "Members", to: "/clients", icon: Users, group: "Workspace" },
  { label: "Leads & Follow-ups", to: "/leads", icon: UserPlus, group: "Workspace" },
  { label: "Billing", to: "/billing", icon: CreditCard, group: "Workspace" },
  { label: "Attendance", to: "/attendance", icon: CalendarCheck, group: "Workspace" },
  { label: "Income & Expenses", to: "/expenses", icon: ReceiptIndianRupee, group: "Workspace" },
  { label: "Packages & Trainers", to: "/packages", icon: Package, group: "Workspace" },

  { label: "PT Sessions", to: "/pt-sessions", icon: Dumbbell, group: "More" },
  { label: "Group Classes", to: "/group-classes", icon: UsersRound, group: "More" },
  { label: "Bookings", to: "/bookings", icon: CalendarClock, group: "More" },
  { label: "Birthdays", to: "/birthdays", icon: Cake, group: "More" },
  { label: "Reports", to: "/reports", icon: BarChart3, group: "More" },
  { label: "Workout Plans", to: "/workout-plans", icon: Dumbbell, group: "More" },
  { label: "Diet Plans", to: "/diet-plans", icon: Salad, group: "More" },
  { label: "Activity Log", to: "/activity-log", icon: History, group: "More" },
  { label: "Message History", to: "/notifications", icon: Bell, group: "More" },

  {
    label: "Fingerprint Devices",
    to: "/biometric-devices",
    icon: Fingerprint,
    group: "Management",
  },
  { label: "Settings & WhatsApp", to: "/settings", icon: Settings, group: "Management" },
];

/** Bottom bar on phones; the centre "+" button sits between these. */
export const MOBILE_NAV_PATHS = ["/dashboard", "/clients", "/leads", "/billing"];
