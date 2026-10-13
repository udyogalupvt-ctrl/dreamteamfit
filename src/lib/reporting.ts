import type { StatTone } from "@/types";

export interface ReportDateRange { start: string; end: string }
export interface ReportMetric { id: string; label: string; value: string; hint?: string; tone?: StatTone }
export interface ExportableReportSection { id: string; title: string; metrics: ReportMetric[]; rows: Record<string, string | number>[] }
export interface ProfitLossSummary { revenue: number | null; expenses: number; profitLoss: number | null }


export function isDateInRange(value: string, range: ReportDateRange) {
  return value >= range.start && value <= range.end;
}

/** Billing will supply revenue later; until then profit/loss remains unavailable. */
export function calculateProfitLoss(revenue: number | null, expenses: number): ProfitLossSummary {
  return { revenue, expenses, profitLoss: revenue === null ? null : revenue - expenses };
}
