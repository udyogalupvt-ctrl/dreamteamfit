import { endOfMonth, endOfWeek, endOfYear, format, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import type { StatTone } from "@/types";

export const REPORT_PERIODS = ["today", "week", "month", "year", "custom"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export interface ReportDateRange { start: string; end: string }
export interface ReportMetric { id: string; label: string; value: string; hint?: string; tone?: StatTone }
export interface ExportableReportSection { id: string; title: string; metrics: ReportMetric[]; rows: Record<string, string | number>[] }

const iso = (date: Date) => format(date, "yyyy-MM-dd");
export function getReportDateRange(period: ReportPeriod, custom?: ReportDateRange): ReportDateRange {
  const now = new Date();
  if (period === "custom" && custom?.start && custom.end) return custom;
  if (period === "today") return { start: iso(now), end: iso(now) };
  if (period === "week") return { start: iso(startOfWeek(now, { weekStartsOn: 1 })), end: iso(endOfWeek(now, { weekStartsOn: 1 })) };
  if (period === "year") return { start: iso(startOfYear(now)), end: iso(endOfYear(now)) };
  return { start: iso(startOfMonth(now)), end: iso(endOfMonth(now)) };
}

export function isDateInRange(value: string, range: ReportDateRange) {
  return value >= range.start && value <= range.end;
}
