import {
  BarChart3,
  BookOpenCheck,
  Bell,
  Cake,
  CalendarCheck,
  CalendarClock,
  CreditCard,
  Dumbbell,
  Fingerprint,
  History,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  PhoneCall,
  ReceiptIndianRupee,
  Salad,
  Settings,
  UserCog,
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
  { label: "Members", to: "/clients", icon: Users, feature: "members", group: "Workspace" },
  {
    label: "Leads & Follow-ups",
    to: "/leads",
    icon: UserPlus,
    feature: "leads",
    group: "Workspace",
  },
  { label: "Billing", to: "/billing", icon: CreditCard, feature: "billing", group: "Workspace" },
  {
    label: "Member Calls",
    to: "/member-calls",
    icon: PhoneCall,
    feature: "memberCalls",
    group: "Workspace",
  },
  {
    label: "Announcements",
    to: "/announcements",
    icon: Megaphone,
    feature: "announcements",
    group: "Workspace",
  },
  {
    label: "Day Book",
    to: "/day-book",
    icon: BookOpenCheck,
    feature: "daybook",
    group: "Workspace",
  },
  {
    label: "Attendance",
    to: "/attendance",
    icon: CalendarCheck,
    feature: "attendance",
    group: "Workspace",
  },
  {
    label: "Income & Expenses",
    to: "/expenses",
    icon: ReceiptIndianRupee,
    feature: "finance",
    group: "Workspace",
  },
  {
    label: "Packages & Trainers",
    to: "/packages",
    icon: Package,
    feature: "packages",
    group: "Workspace",
  },

  { label: "PT Sessions", to: "/pt-sessions", icon: Dumbbell, feature: "classes", group: "More" },
  {
    label: "Group Classes",
    to: "/group-classes",
    icon: UsersRound,
    feature: "classes",
    group: "More",
  },
  { label: "Bookings", to: "/bookings", icon: CalendarClock, feature: "classes", group: "More" },
  { label: "Birthdays", to: "/birthdays", icon: Cake, feature: "members", group: "More" },
  { label: "Reports", to: "/reports", icon: BarChart3, feature: "reports", group: "More" },
  {
    label: "Workout Plans",
    to: "/workout-plans",
    icon: Dumbbell,
    feature: "classes",
    group: "More",
  },
  { label: "Diet Plans", to: "/diet-plans", icon: Salad, feature: "classes", group: "More" },
  { label: "Activity Log", to: "/activity-log", icon: History, feature: "activity", group: "More" },
  { label: "Message History", to: "/notifications", icon: Bell, feature: "members", group: "More" },
  {
    label: "WhatsApp Usage",
    to: "/whatsapp-usage",
    icon: MessageCircle,
    feature: "settings",
    group: "More",
  },

  { label: "Staff", to: "/staff", icon: UserCog, feature: "owner", group: "Management" },
  {
    label: "Fingerprint Devices",
    to: "/biometric-devices",
    icon: Fingerprint,
    feature: "devices",
    group: "Management",
  },
  {
    label: "Settings & WhatsApp",
    to: "/settings",
    icon: Settings,
    feature: "settings",
    group: "Management",
  },
];

/** Bottom bar on phones; the centre "+" button sits between these. */
export const MOBILE_NAV_PATHS = ["/dashboard", "/clients", "/leads", "/billing"];
