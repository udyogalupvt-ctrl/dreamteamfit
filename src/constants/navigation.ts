import {
  BarChart3,
  CalendarCheck,
  CreditCard,
  LayoutDashboard,
  MessageSquareHeart,
  Package,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import type { NavItem } from "@/types";

export const APP_NAME = "FORGE";
export const APP_TAGLINE = "Gym OS";
export const GYM_NAME = "Ironline Fitness";

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, group: "Workspace" },
  { label: "Inquiries", to: "/inquiries", icon: UserPlus, group: "Workspace", badge: 6 },
  { label: "Clients", to: "/clients", icon: Users, group: "Workspace" },
  { label: "Packages", to: "/packages", icon: Package, group: "Workspace" },
  { label: "Billing & Payments", to: "/billing", icon: CreditCard, group: "Workspace" },
  { label: "Attendance", to: "/attendance", icon: CalendarCheck, group: "Workspace" },
  { label: "Follow-ups", to: "/follow-ups", icon: MessageSquareHeart, group: "Workspace", badge: 12 },
  { label: "Reports", to: "/reports", icon: BarChart3, group: "Workspace" },
  { label: "Settings", to: "/settings", icon: Settings, group: "Management" },
];

/** Primary destinations surfaced in the mobile bottom bar. */
export const MOBILE_NAV_PATHS = ["/dashboard", "/clients", "/attendance", "/billing"];
