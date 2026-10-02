import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Activity,
  BadgeIndianRupee,
  CalendarCheck,
  CalendarClock,
  Download,
  Dumbbell,
  FileSpreadsheet,
  Loader2,
  ReceiptIndianRupee,
  Salad,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReportsData } from "@/hooks/use-reports-data";
import { formatDateISO, formatNumber, formatPrice, todayISO } from "@/lib/format";
import { downloadCsv, downloadExcel, type ReportSheet } from "@/lib/report-export";
import type { ReportDateRange, ReportPeriod } from "@/lib/reporting";
import { EXPENSE_CATEGORIES } from "@/types/models";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — REBUILD FITNESS" },
      {
        name: "description",
        content: "Real gym performance, expense, membership, inquiry and booking reports.",
      },
      { property: "og:title", content: "Reports — REBUILD FITNESS" },
      {
        property: "og:description",
        content: "Real gym performance, expense, membership, inquiry and booking reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});
const labels: Record<ReportPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  custom: "Custom",
};
function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [custom, setCustom] = useState<ReportDateRange>({ start: todayISO(), end: todayISO() });
  const report = useReportsData(period, custom);
  const [exporting, setExporting] = useState(false);
  const max = Math.max(...report.expenseBreakdown.map((x) => x.amount), 0);
  if (report.loading)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Real performance and financial reporting."
          breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Reports" }]}
        />
        <LoadingRows rows={7} />
      </div>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Money, members and plans for any period."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Reports" }]}
        actions={
          <Button
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              downloadExcel(fileBase(report.range, "report") + ".xlsx", report.sheets)
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet aria-hidden />
            )}
            Download Excel
          </Button>
        }
      />
      {report.error ? <ErrorState error={report.error} title="Couldn't load reports" /> : null}
      <section className="surface-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-label">Report period</p>
            <p className="text-meta mt-1">
              {formatDateISO(report.range.start)} to {formatDateISO(report.range.end)}
            </p>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5 lg:w-auto">
              {Object.entries(labels).map(([v, l]) => (
                <TabsTrigger key={v} value={v}>
                  {l}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {period === "custom" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input
              aria-label="Custom start date"
              type="date"
              value={custom.start}
              onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
            />
            <Input
              aria-label="Custom end date"
              type="date"
              min={custom.start}
              value={custom.end}
              onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
            />
          </div>
        ) : null}
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          icon={BadgeIndianRupee}
          title="Collected Revenue"
          value={formatPrice(report.revenue.collected)}
          hint={`${formatPrice(report.revenue.outstanding)} outstanding · ${formatPrice(report.revenue.grossSales)} gross sales`}
        />
        <MetricCard
          icon={ReceiptIndianRupee}
          title="Expenses"
          value={formatPrice(report.expenseTotal)}
          hint="Real expenses in selected period"
        />
        <MetricCard
          icon={TrendingUp}
          title="Profit/Loss"
          value={formatPrice(report.financials.profitLoss ?? 0)}
          hint="Collected revenue minus expenses"
        />
      </div>
      <section className="surface-card min-w-0 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-section-title">Expense Report</h2>
            <p className="text-meta mt-1">Category breakdown from real expense records</p>
          </div>
          <p className="text-xl font-extrabold tabular-nums">{formatPrice(report.expenseTotal)}</p>
        </div>
        {report.expenseRows.length === 0 ? (
          <EmptyState
            icon={ReceiptIndianRupee}
            title="No expense data yet"
            description="Expenses in this date range will appear here."
          />
        ) : (
          <div className="mt-6 space-y-3" role="img" aria-label="Expense totals by category">
            {report.expenseBreakdown.map((item) => (
              <div
                key={item.category}
                className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto]"
              >
                <span className="truncate text-sm font-medium">
                  {item.category === "Staff Salary" ? "Salary" : item.category}
                </span>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${max ? (item.amount / max) * 100 : 0}%` }}
                  />
                </div>
                <span className="min-w-20 text-right text-sm font-bold tabular-nums">
                  {formatPrice(item.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <ReportSection
          icon={Users}
          title="Members & plans"
          metrics={[
            ["Total Members", report.clients.total],
            ["Active Members", report.clients.active],
            ["Expired Members", report.clients.expired],
            ["New Members", report.clients.newClients],
            ["New Memberships", report.clients.newMemberships],
            ["Upcoming Renewals", report.clients.upcoming],
          ]}
        />
        <ReportSection
          icon={UserPlus}
          title="Inquiries"
          empty={report.inquiries.total === 0}
          emptyText="No inquiry data yet"
          metrics={[
            ["Total Inquiries", report.inquiries.total],
            ["New", report.inquiries.counts["new"] ?? 0],
            ["Contacted", report.inquiries.counts["contacted"] ?? 0],
            ["Interested", report.inquiries.counts["interested"] ?? 0],
            ["Follow-up", report.inquiries.counts["follow_up"] ?? 0],
            ["Converted", report.inquiries.counts["converted"] ?? 0],
            ["Lost", report.inquiries.counts["lost"] ?? 0],
            [
              "Conversion Rate",
              report.inquiries.conversionRate === null
                ? "—"
                : `${report.inquiries.conversionRate}%`,
            ],
          ]}
        />
        <ReportSection
          icon={CalendarClock}
          title="Bookings"
          metrics={[
            ["Total Bookings", report.bookings.total],
            ["PT Sessions", report.bookings.pt],
            ["Group Class Bookings", report.bookings.group],
            ["Completed", report.bookings.completed],
            ["Cancelled", report.bookings.cancelled],
            ["No-show", report.bookings.noShow],
          ]}
        />
        <ReportSection
          icon={Dumbbell}
          title="Workout & Diet Plans"
          empty={report.plans.workoutAssignments + report.plans.dietAssignments === 0}
          emptyText="No workout or diet assignments in this period"
          metrics={[
            ["Active Workout Plans", report.plans.activeWorkouts],
            ["Active Diet Plans", report.plans.activeDiets],
            ["Workout Assignments", report.plans.workoutAssignments],
            ["Diet Assignments", report.plans.dietAssignments],
          ]}
        />
        <ReportSection
          icon={CalendarCheck}
          title="Attendance"
          empty={report.attendance.visits + (report.attendance.blocked ?? 0) === 0}
          emptyText="No attendance data in this period"
          metrics={[
            ["Allowed Visits", report.attendance.visits],
            ["Unique Members", report.attendance.unique],
            // Longer than a month: counted, not loaded, so blocked attempts aren't split out.
            ["Blocked Attempts", report.attendance.blocked ?? "—"],
          ]}
        />
      </div>
      <ExportCard sheets={report.sheets} range={report.range} />
    </div>
  );
}
/** "rebuild-fitness-bills-2026-10-01-to-2026-10-31" */
const fileBase = (range: ReportDateRange, what: string) =>
  `rebuild-fitness-${what}-${range.start}${range.start === range.end ? "" : `-to-${range.end}`}`;

function ExportCard({ sheets, range }: { sheets: ReportSheet[]; range: ReportDateRange }) {
  const [busy, setBusy] = useState(false);
  const excel = () => {
    setBusy(true);
    downloadExcel(fileBase(range, "report") + ".xlsx", sheets)
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="surface-card p-5" aria-labelledby="report-export-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="report-export-title" className="text-section-title flex items-center gap-2">
            <FileSpreadsheet className="size-5" aria-hidden /> Download this report
          </h2>
          <p className="text-meta mt-1">
            {formatDateISO(range.start)} to {formatDateISO(range.end)} · Excel has every sheet below
            in one file; CSV is one sheet.
          </p>
        </div>
        <Button onClick={excel} disabled={busy}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet aria-hidden />
          )}
          Excel (all sheets)
        </Button>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {sheets.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
          >
            <div className="min-w-0">
              <p className="font-semibold">
                {s.title}{" "}
                <span className="text-meta font-normal tabular-nums">
                  · {formatNumber(s.rows.length)} {s.rows.length === 1 ? "row" : "rows"}
                </span>
              </p>
              <p className="text-meta line-clamp-2">{s.hint}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              aria-label={`Download ${s.title} as CSV`}
              onClick={() => downloadCsv(`${fileBase(range, s.id)}.csv`, s)}
            >
              <Download aria-hidden /> CSV
            </Button>
          </li>
        ))}
      </ul>
      {!sheets.some((s) => s.id === "visits") ? (
        <p className="text-meta mt-3">
          The list of every visit is included for periods of up to 31 days. Pick a shorter period to
          download it.
        </p>
      ) : null}
    </section>
  );
}
function MetricCard({
  icon: Icon,
  title,
  value,
  hint,
}: {
  icon: typeof Activity;
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="surface-card p-5">
      <span className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-eyebrow mt-4">{title}</p>
      <p className="text-stat mt-2">{value}</p>
      <p className="text-meta mt-1">{hint}</p>
    </article>
  );
}
function ReportSection({
  icon: Icon,
  title,
  metrics,
  empty,
  emptyText,
}: {
  icon: typeof Activity;
  title: string;
  metrics: (readonly [string, string | number])[];
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <section className="surface-card p-5">
      <div className="flex items-center gap-3">
        <Icon className="size-5 text-primary-foreground" />
        <h2 className="text-section-title">{title}</h2>
      </div>
      {empty ? (
        <p className="text-meta py-8 text-center">{emptyText}</p>
      ) : (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-meta truncate">{label}</dt>
              <dd className="mt-1 text-xl font-extrabold tabular-nums">
                {typeof value === "number" ? formatNumber(value) : value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
