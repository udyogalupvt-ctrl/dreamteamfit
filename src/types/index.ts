import type { LucideIcon } from "lucide-react";

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string;
  photoURL: string | null;
}

export type NavGroupLabel = "Workspace" | "More" | "Management";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  group: NavGroupLabel;
  badge?: number;
  children?: { label: string; to: string }[];
}

export type ThemeMode = "light" | "dark" | "system";

export type StatTone = "primary" | "success" | "warning" | "danger" | "info" | "violet";

export interface StatMetric {
  id: string;
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" | "flat" };
  hint?: string;
  icon: LucideIcon;
  tone: StatTone;
}

export interface ActivityItem {
  id: string;
  title: string;
  description: string;
  time: string;
  tone: StatTone;
  icon: LucideIcon;
}
