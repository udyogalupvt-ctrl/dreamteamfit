import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format, startOfMonth } from "date-fns";
import {
  CalendarDays,
  CircleDollarSign,
  Plus,
  ReceiptIndianRupee,
  WalletCards,
} from "lucide-react";
import { z } from "zod";
import { CreateBillDialog } from "@/components/billing/create-bill-dialog";
import { InvoiceActions } from "@/components/billing/invoice-actions";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatCard } from "@/components/common/stat-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLive } from "@/hooks/use-live-query";
import { INVOICE_STATUS_META, formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import { buildFinanceSummary, subscribePayments } from "@/services/finance.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { subscribePackages } from "@/services/packages.service";
import type { Invoice, Payment } from "@/types/models";

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: z.object({ create: z.boolean().optional(), clientId: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Billing & Payments — REBUILD FITNESS" },
      { name: "description", content: "Bills, balances due and collections." },
    ],
  }),
  component: BillingPage,
});

type StatusFilter = "all" | "due" | "paid";

function BillingPage() {
  const searchParams = Route.useSearch();
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);
  const payments = useLive<Payment[]>(subscribePayments, [], []);
  const clients = useLive(subscribeClients, [], []);
  const packages = useLive(subscribePackages, [], []);
  const settings = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const [open, setOpen] = useState(Boolean(searchParams.create));
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return invoices.data.filter(
      (i) =>
        (!date || i.invoiceDate === date) &&
        (status === "all" ||
          (status === "due"
            ? i.balanceDue > 0 && i.paymentStatus !== "refunded"
            : i.balanceDue === 0)) &&
        (!q ||
          [i.invoiceNumber, i.clientNameSnapshot, i.clientPhoneSnapshot].some((v) =>
            v.toLowerCase().includes(q),
          )),
    );
  }, [invoices.data, search, date, status]);

  const today = todayISO();
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const collectedToday = buildFinanceSummary(
    payments.data,
    invoices.data,
    [],
    [],
    today,
    today,
  ).gross;
  const collectedMonth = buildFinanceSummary(
    payments.data,
    invoices.data,
    [],
    [],
    monthStart,
    today,
  ).gross;
  const dueInvoices = invoices.data.filter(
    (i) => i.paymentStatus !== "refunded" && i.balanceDue > 0,
  );
  const outstanding = dueInvoices.reduce((n, i) => n + i.balanceDue, 0);
  const cards = [
    {
      id: "today",
      label: "Collected today",
      value: formatPrice(collectedToday),
      hint: "all payments received today",
      icon: CalendarDays,
      tone: "success" as const,
    },
    {
      id: "month",
      label: "This month",
      value: formatPrice(collectedMonth),
      hint: "payments received",
      icon: CircleDollarSign,
      tone: "primary" as const,
    },
    {
      id: "due",
      label: "Balance due",
      value: formatPrice(outstanding),
      hint: `${dueInvoices.length} bill${dueInvoices.length === 1 ? "" : "s"} not fully paid`,
      icon: WalletCards,
      tone: "warning" as const,
    },
  ];
  const error =
    invoices.error || payments.error || clients.error || packages.error || settings.error;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing & Payments"
        description="Every bill, what's been paid and what's still due."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Billing" }]}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden /> New bill
          </Button>
        }
      />
      {error ? <ErrorState error={error} title="Couldn't load billing data" /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((m, i) => (
          <StatCard key={m.id} metric={m} className={cn(i === 2 && "col-span-2 lg:col-span-1")} />
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Bill no., name or phone…"
            label="Search bills"
            containerClassName="md:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="no-scrollbar flex gap-1.5 overflow-x-auto"
              role="tablist"
              aria-label="Payment status"
            >
              {(
                [
                  ["all", "All"],
                  ["due", "Balance due"],
                  ["paid", "Paid"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={status === v}
                  onClick={() => setStatus(v)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold",
                    status === v
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <Input
              type="date"
              aria-label="Filter by bill date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40 shrink-0"
            />
          </div>
        </div>

        {invoices.loading ? (
          <LoadingRows rows={5} />
        ) : !invoices.data.length ? (
          <EmptyState
            icon={ReceiptIndianRupee}
            title="No bills yet"
            description="Bills are created automatically when a member joins or renews."
          />
        ) : !filtered.length ? (
          <EmptyState
            icon={ReceiptIndianRupee}
            title="No matching bills"
            description="Try another search or filter."
          />
        ) : (
          <>
            <div className="surface-card hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <p className="font-semibold">{i.invoiceNumber}</p>
                        <p className="text-meta">
                          {formatDateISO(i.invoiceDate)} · {i.paymentMethod}
                        </p>
                        <p className="text-meta">
                          By {i.createdBy}
                          {i.counsellorName ? ` · counsellor ${i.counsellorName}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-48 truncate">{i.clientNameSnapshot}</p>
                        <p className="text-meta">{i.clientPhoneSnapshot}</p>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatPrice(i.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPrice(i.amountPaid)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          i.balanceDue > 0 && "font-bold text-destructive",
                        )}
                      >
                        {formatPrice(i.balanceDue)}
                        {i.balanceDue > 0 && i.dueDate ? (
                          <p className="text-meta font-normal">due {formatDateISO(i.dueDate)}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={INVOICE_STATUS_META[i.paymentStatus].tone}>
                          {INVOICE_STATUS_META[i.paymentStatus].label}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <InvoiceActions invoice={i} compact />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="grid gap-3 md:hidden">
              {filtered.map((i) => (
                <li className="surface-card space-y-3 p-4" key={i.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{i.clientNameSnapshot}</p>
                      <p className="text-meta">
                        {i.invoiceNumber} · {formatDateISO(i.invoiceDate)}
                      </p>
                      <p className="text-meta">
                        By {i.createdBy}
                        {i.counsellorName ? ` · counsellor ${i.counsellorName}` : ""}
                        {i.balanceDue > 0 && i.dueDate ? ` · due ${formatDateISO(i.dueDate)}` : ""}
                      </p>
                    </div>
                    <StatusPill tone={INVOICE_STATUS_META[i.paymentStatus].tone}>
                      {INVOICE_STATUS_META[i.paymentStatus].label}
                    </StatusPill>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-meta">Total</p>
                      <p className="font-bold tabular-nums">{formatPrice(i.total)}</p>
                    </div>
                    <div>
                      <p className="text-meta">Paid</p>
                      <p className="font-bold tabular-nums">{formatPrice(i.amountPaid)}</p>
                    </div>
                    <div>
                      <p className="text-meta">Balance</p>
                      <p
                        className={cn(
                          "font-bold tabular-nums",
                          i.balanceDue > 0 && "text-destructive",
                        )}
                      >
                        {formatPrice(i.balanceDue)}
                      </p>
                    </div>
                  </div>
                  <InvoiceActions invoice={i} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <CreateBillDialog
        open={open}
        onOpenChange={setOpen}
        clients={clients.data}
        packages={packages.data}
        settings={settings.data}
        initialClientId={searchParams.clientId}
      />
    </div>
  );
}
