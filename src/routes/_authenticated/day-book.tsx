import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { endOfWeek, format, startOfMonth, startOfWeek, subDays } from "date-fns";
import { Download, HandCoins, Plus, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { z } from "zod";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusPill } from "@/components/common/status-pill";
import { ExpenseFormDialog } from "@/components/expenses/expense-form-dialog";
import { SettleDialog } from "@/components/expenses/settle-dialog";
import { emptyRow, HandoverDialog } from "@/components/finance/cash-book-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLive } from "@/hooks/use-live-query";
import { buildCashBook, type CashBookRow, type CashDay } from "@/lib/cash-book";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { subscribeExpenses } from "@/services/expenses.service";
import { subscribeCashDays, subscribePayments } from "@/services/finance.service";
import { subscribeStaff } from "@/services/staff.service";
import type { Expense, Payment, Staff } from "@/types/models";

export const Route = createFileRoute("/_authenticated/day-book")({
  validateSearch: z.object({ add: z.enum(["expense"]).optional() }),
  head: () => ({ meta: [{ title: "Day book — REBUILD FITNESS" }] }),
  component: DayBookPage,
});

type Period = "today" | "yesterday" | "week" | "month" | "custom";

/**
 * The front desk's daily register, instead of the Excel sheet: who paid, expenses (who gave
 * the money, settled or not) and cash (opening, received, expenses, balance, handover).
 */
function DayBookPage() {
  const { add } = Route.useSearch();
  const payments = useLive<Payment[]>(subscribePayments, [], []);
  const expenses = useLive<Expense[]>(subscribeExpenses, [], []);
  const days = useLive<CashDay[]>(subscribeCashDays, [], []);
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const today = todayISO();
  const [period, setPeriod] = useState<Period>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [adding, setAdding] = useState(add === "expense");
  const [settling, setSettling] = useState<Expense | null>(null);
  const [handover, setHandover] = useState<CashBookRow | null>(null);

  const [start, end] = useMemo<[string, string]>(() => {
    const now = new Date();
    const f = (d: Date) => format(d, "yyyy-MM-dd");
    if (period === "yesterday") return [f(subDays(now, 1)), f(subDays(now, 1))];
    if (period === "week")
      return [f(startOfWeek(now, { weekStartsOn: 1 })), f(endOfWeek(now, { weekStartsOn: 1 }))];
    if (period === "month") return [f(startOfMonth(now)), today];
    if (period === "custom") return [from, to];
    return [today, today];
  }, [period, from, to, today]);

  const paid = payments.data
    .filter((p) => p.paymentDate >= start && p.paymentDate <= end)
    .sort(
      (a, b) =>
        b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const spent = expenses.data.filter((e) => e.date >= start && e.date <= end);
  const book = useMemo(
    () => buildCashBook(payments.data, [], expenses.data, days.data, today),
    [payments.data, expenses.data, days.data, today],
  );
  const cashRows = book.filter((r) => r.date >= start && r.date <= end).reverse();
  const cashNow = book[book.length - 1]?.closing ?? 0;
  const byMethod = paid.reduce<Record<string, number>>(
    (m, p) => ({ ...m, [p.method]: (m[p.method] ?? 0) + p.amount }),
    {},
  );
  const collected = paid.reduce((n, p) => n + p.amount, 0);
  const spentTotal = spent.reduce((n, e) => n + e.amount, 0);
  const handedOver = cashRows.reduce((n, r) => n + r.handover, 0);
  const label =
    start === end ? formatDateISO(start) : `${formatDateISO(start)} – ${formatDateISO(end)}`;

  const sheets = () => ({
    "Who paid": paid.map((p) => ({
      Date: p.paymentDate,
      Member: p.clientNameSnapshot,
      Bill: p.invoiceNumber,
      Amount: p.amount,
      "Paid by": p.method,
      "Joining / balance": p.kind === "balance" ? "Balance" : "Payment",
      "Collected by": p.createdBy,
      Counsellor: p.counsellorName,
    })),
    Expenses: spent.map((e) => ({
      Date: e.date,
      Title: e.title,
      Category: e.category,
      Amount: e.amount,
      Note: [e.description, e.notes].filter(Boolean).join(" · "),
      "Method of payment": e.paymentMethod,
      "Who gave the money": e.paidBy,
      Settled:
        e.paidBy === "Gym" ? "—" : e.settled ? `Yes (${e.settledMethod} ${e.settledDate})` : "No",
      "Entered by": e.createdBy,
    })),
    "Cash book": [...cashRows].reverse().map((r) => ({
      Date: r.date,
      "Opening balance": r.opening,
      "Received cash": r.received,
      Expenses: r.expenses,
      Balance: r.balance,
      Handover: r.handover,
      "Handed to": r.handoverTo,
      Closing: r.closing,
    })),
  });

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets()))
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "Nothing in this period" }]),
        name,
      );
    XLSX.writeFile(wb, `day-book-${start}${start === end ? "" : `-to-${end}`}.xlsx`);
  };

  const print = () => {
    const esc = (v: unknown) =>
      String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const table = (title: string, rows: Record<string, unknown>[]) =>
      `<h2>${esc(title)}</h2>` +
      (rows.length
        ? `<table><thead><tr>${Object.keys(rows[0]!)
            .map((k) => `<th>${esc(k)}</th>`)
            .join("")}</tr></thead><tbody>${rows
            .map(
              (r) =>
                `<tr>${Object.values(r)
                  .map((v) => `<td>${esc(v)}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}</tbody></table>`
        : "<p>Nothing in this period.</p>");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<html><head><title>Day book ${esc(label)}</title><style>body{font-family:system-ui,sans-serif;padding:16px}table{border-collapse:collapse;width:100%;margin-bottom:18px;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}h1{font-size:18px}h2{font-size:15px;margin-top:16px}</style></head><body><h1>Day book · ${esc(label)}</h1><p>Collected ${esc(formatPrice(collected))} · Expenses ${esc(formatPrice(spentTotal))} · Cash in hand now ${esc(formatPrice(cashNow))}</p>` +
        Object.entries(sheets())
          .map(([n, r]) => table(n, r))
          .join("") +
        "</body></html>",
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const loading = payments.loading || expenses.loading || days.loading;
  const error = payments.error ?? expenses.error ?? days.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day book"
        description="Who paid, expenses and cash for the day. Download for Excel or print."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Day book" }]}
        actions={
          <>
            <Button variant="outline" onClick={downloadExcel} disabled={loading}>
              <Download aria-hidden /> Excel
            </Button>
            <Button variant="outline" onClick={print} disabled={loading}>
              <Printer aria-hidden /> Print
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="week">This week</SelectItem>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="custom">Pick dates</SelectItem>
          </SelectContent>
        </Select>
        {period === "custom" ? (
          <>
            <Input
              type="date"
              aria-label="From"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="w-auto"
            />
            <Input
              type="date"
              aria-label="To"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="w-auto"
            />
          </>
        ) : (
          <span className="text-sm font-semibold">{label}</span>
        )}
      </div>
      {error ? <ErrorState error={error} title="Couldn't load the day book" /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Collected"
          value={formatPrice(collected)}
          hint={
            Object.entries(byMethod)
              .map(([m, n]) => `${m} ${formatPrice(n)}`)
              .join(" · ") || "No payments"
          }
        />
        <Card
          label="Expenses"
          value={formatPrice(spentTotal)}
          hint={`${spent.length} entr${spent.length === 1 ? "y" : "ies"}`}
        />
        <Card label="Handed over" value={formatPrice(handedOver)} hint="Cash given to the owner" />
        <Card label="Cash in hand now" value={formatPrice(cashNow)} hint="After today's handover" />
      </div>

      {loading ? (
        <LoadingRows rows={6} />
      ) : (
        <>
          <section className="surface-card overflow-hidden">
            <h2 className="text-section-title border-b border-border p-4">
              Who paid · {paid.length}
            </h2>
            {paid.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Bill</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Paid by</TableHead>
                      <TableHead>Collected by</TableHead>
                      <TableHead>Counsellor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paid.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDateISO(p.paymentDate)}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {p.clientNameSnapshot}
                          {p.kind === "balance" ? (
                            <span className="text-meta block font-normal">balance</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{p.invoiceNumber}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {formatPrice(p.amount)}
                        </TableCell>
                        <TableCell>{p.method}</TableCell>
                        <TableCell>{p.createdBy || "—"}</TableCell>
                        <TableCell>{p.counsellorName || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-meta p-4">No payments in this period.</p>
            )}
          </section>

          <section className="surface-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <h2 className="text-section-title">Expenses · {spent.length}</h2>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Add expense
              </Button>
            </div>
            {spent.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Who gave</TableHead>
                      <TableHead>Settled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spent.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{formatDateISO(e.date)}</TableCell>
                        <TableCell className="font-semibold">
                          {e.title}
                          <span className="text-meta block font-normal">{e.category}</span>
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {formatPrice(e.amount)}
                        </TableCell>
                        <TableCell className="max-w-48 truncate">
                          {[e.description, e.notes].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                        <TableCell>{e.paymentMethod}</TableCell>
                        <TableCell>{e.paidBy}</TableCell>
                        <TableCell>
                          {e.paidBy === "Gym" ? (
                            "—"
                          ) : e.settled ? (
                            <StatusPill tone="success">Yes · {e.settledMethod}</StatusPill>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setSettling(e)}>
                              Not yet · pay back
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-meta p-4">No expenses in this period.</p>
            )}
          </section>

          <section className="surface-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <h2 className="text-section-title">Cash</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setHandover(book.find((r) => r.date === today) ?? emptyRow(today, cashNow))
                }
              >
                <HandCoins aria-hidden /> Today&apos;s handover
              </Button>
            </div>
            {cashRows.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Received cash</TableHead>
                      <TableHead className="text-right">Expenses</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Handover</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashRows.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell className="whitespace-nowrap font-semibold">
                          {formatDateISO(r.date)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPrice(r.opening)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success">
                          +{formatPrice(r.received)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          −{formatPrice(r.expenses)}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {formatPrice(r.balance)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.handover
                            ? `${formatPrice(r.handover)}${r.handoverTo ? ` → ${r.handoverTo}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setHandover(r)}>
                            Handover
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-meta p-4">
                No cash entries in this period. Set the opening cash with Today&apos;s handover.
              </p>
            )}
          </section>
        </>
      )}
      <ExpenseFormDialog open={adding} onOpenChange={setAdding} />
      <SettleDialog expense={settling} onClose={() => setSettling(null)} />
      <HandoverDialog
        row={handover}
        people={staff.data.map((s) => s.name)}
        onClose={() => setHandover(null)}
      />
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="surface-card p-4">
      <p className="text-meta">{label}</p>
      <p className="text-stat tabular-nums">{value}</p>
      <p className="text-meta truncate">{hint}</p>
    </div>
  );
}
