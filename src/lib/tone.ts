import type { StatTone } from "@/types";

/** Centralized tone -> token mapping so components never hardcode colors. */
export const toneIcon: Record<StatTone, string> = {
  primary: "bg-primary/20 text-foreground dark:text-primary ring-primary/30",
  success: "bg-success/15 text-success ring-success/25",
  warning: "bg-warning/20 text-warning ring-warning/30",
  danger: "bg-destructive/15 text-destructive ring-destructive/25",
  info: "bg-info/15 text-info ring-info/25",
  violet: "bg-violet/15 text-violet ring-violet/25",
};

export const toneBar: Record<StatTone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  violet: "bg-violet",
};
