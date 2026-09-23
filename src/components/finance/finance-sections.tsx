import { useMemo, useState } from "react";
import { endOfMonth, format, startOfMonth, startOfYear, subMonths } from "date-fns";
import { CheckCircle2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { StatCard } from "@/components/common/stat-card";
import { StatusPill } from "@/components/common/status-pill";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addManualIncome,
  buildFinanceSummary,
  setPayoutStatus,
  subscribeManualIncome,
  subscribePayments,
  subscribePayouts,
} from "@/services/finance.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { subscribeExpenses } from "@/services/expenses.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  PAYMENT_METHODS,
  type Expense,
  type Invoice,
  type ManualIncome,
  type Payment,
  type PaymentMethod,
  type TrainerPayout,
} from "@/types/models";

type Period = "today" | "month" | "last" | "year" | "custom";
const iso = (d: Date) => format(d, "yyyy-MM-dd");
function rangeFor(p: Period, from: string, to: string): [string, string] {
  const now = new Date();
  if (p === "today") return [todayISO(), todayISO()];
  if (p === "month") return [iso(startOfMonth(now)), todayISO()];
  if (p === "last") {
    const last = subMonths(now, 1);
    return [iso(startOfMonth(last)), iso(endOfMonth(last))];
  }
  if (p === "year") return [iso(startOfYear(now)), todayISO()];
  return [from, to];
}

type Row = {
  id: string;
  date: string;
  title: string;
  detail: string;
  amount: number;
  method: string;
  kind: "payment" | "manual";
};

export function IncomeSection() {
  const { user } = useAuth();
  const payments = useLive(subscribePayments, [] as Payment[], []);
  const invoices = useLive(subscribeInvoices, [] as Invoice[], []);
  const manual = useLive(subscribeManualIncome, [] as ManualIncome[], []);
  const expenses = useLive(subscribeExpenses, [] as Expense[], []);
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(iso(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState(todayISO());
  const [from, to] = rangeFor(period, customFrom, customTo);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    title: "",
    category: "Other",
    amount: "",
    method: "Cash" as PaymentMethod,
    date: todayISO(),
    notes: "",
  });

  const s = useMemo(
    () =>
      buildFinanceSummary(
        payments.data,
        invoices.data,
        manual.data,
        expenses.data.map((e) => ({ amount: e.amount, date: e.date })),
        from,
        to,
      ),
    [payments.data, invoices.data, manual.data, expenses.data, from, to],
  );
  const rows = useMemo<Row[]>(() => {
    const inRange = (d: string) => d >= from && d <= to;
    const pay: Row[] = payments.data
      .filter((p) => inRange(p.paymentDate))
      .map((p) => ({
        id: p.id,
        date: p.paymentDate,
        title: p.clientNameSnapshot || "Member",
        detail: [
          p.invoiceNumber,
          p.kind === "balance" ? "balance payment" : null,
          p.membershipGymAmount ? `membership ${formatPrice(p.membershipGymAmount)}` : null,
          p.ptGymAmount || p.trainerShareAmount
            ? `PT gym ${formatPrice(p.ptGymAmount)} · trainer ${formatPrice(p.trainerShareAmount)}`
            : null,
          p.otherGymAmount ? `other ${formatPrice(p.otherGymAmount)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        amount: p.amount,
        method: p.method,
        kind: "payment",
      }));
    const man: Row[] = manual.data
      .filter((m) => inRange(m.date))
      .map((m) => ({
        id: m.id,
        date: m.date,
        title: m.title,
        detail: `${m.category} · added by ${m.createdBy}`,
        amount: m.amount,
        method: m.method,
        kind: "manual",
      }));
    return [...pay, ...man].sort((a, b) => b.date.localeCompare(a.date));
  }, [payments.data, manual.data, from, to]);

  const save = async () => {
    const amount = Number(f.amount);
    if (f.title.trim().length < 2 || !(amount > 0))
      return void toast.error("Enter what it was for and a positive amount");
    try {
      await addManualIncome({
        ...f,
        title: f.title.trim(),
        amount,
        createdBy: user?.displayName || user?.email || "Staff",
      });
      toast.success("Income added");
      setOpen(false);
      setF((x) => ({ ...x, title: "", amount: "" }));
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  const lines: [string, number, string?][] = [
    ["Memberships", s.membershipIncome],
    [
      "PT — gym's share",
      s.ptGymIncome,
      `PT sold ${formatPrice(s.ptGross)}, trainer's share ${formatPrice(s.trainerPayable)} is not gym income`,
    ],
    ["Other income (shop bills + added)", s.otherIncome + s.manualIncome],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="no-scrollbar -mx-4 flex flex-1 gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
          role="tablist"
          aria-label="Period"
        >
          {(
            [
              ["today", "Today"],
              ["month", "This month"],
              ["last", "Last month"],
              ["year", "This year"],
              ["custom", "Custom"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              role="tab"
              aria-selected={period === v}
              onClick={() => setPeriod(v)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold",
                period === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Add other income
        </Button>
      </div>
      {period === "custom" ? (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="From" htmlFor="fi-from">
            <Input
              id="fi-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="fi-to">
            <Input
              id="fi-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="surface-card p-4 sm:p-5">
          <p className="text-eyebrow">
            Profit · {formatDateISO(from)} – {formatDateISO(to)}
          </p>
          <p
            className={cn(
              "font-display mt-1 text-4xl font-extrabold tabular-nums",
              s.net < 0 && "text-destructive",
            )}
          >
            {formatPrice(s.net)}
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            {lines.map(([label, value, hint]) => (
              <div key={label}>
                <div className="flex justify-between gap-3">
                  <dt>{label}</dt>
                  <dd className="font-semibold tabular-nums">{formatPrice(value)}</dd>
                </div>
                {hint ? <p className="text-meta">{hint}</p> : null}
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-border pt-2 font-bold">
              <dt>Gym income</dt>
              <dd className="tabular-nums">{formatPrice(s.gymIncome)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-destructive">
              <dt>− Expenses</dt>
              <dd className="font-semibold tabular-nums">{formatPrice(s.expenses)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-extrabold">
              <dt>Profit</dt>
              <dd className="tabular-nums">{formatPrice(s.net)}</dd>
            </div>
          </dl>
          <p className="text-meta mt-4">
            Total received from members (incl. trainer share): <b>{formatPrice(s.gross)}</b>
          </p>
        </section>

        <section className="surface-card min-w-0 overflow-hidden">
          <h3 className="text-card-title border-b border-border p-4">
            Income entries ({rows.length})
          </h3>
          {!rows.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No income in this period.
            </p>
          ) : (
            <ul className="max-h-[560px] divide-y divide-border overflow-y-auto">
              {rows.map((r) => (
                <li
                  key={`${r.kind}-${r.id}`}
                  className="flex items-start justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {r.title}
                      {r.kind === "manual" ? (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          added
                        </span>
                      ) : null}
                    </p>
                    <p className="text-meta">
                      {formatDateISO(r.date)} · {r.method}
                    </p>
                    {r.detail ? <p className="text-meta break-words">{r.detail}</p> : null}
                  </div>
                  <p className="shrink-0 font-bold tabular-nums">{formatPrice(r.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add other income"
        description="For money not billed to a member, e.g. a vending machine or event."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()}>Save</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="What was it for?" htmlFor="mi-t" required className="col-span-2">
            <Input
              id="mi-t"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder="e.g. Supplement sale"
            />
          </Field>
          <Field label="Amount ₹" htmlFor="mi-a" required>
            <Input
              id="mi-a"
              type="number"
              inputMode="decimal"
              min={0}
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </Field>
          <Field label="Date" htmlFor="mi-d">
            <Input
              id="mi-d"
              type="date"
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </Field>
          <Field label="Received by" htmlFor="mi-m">
            <Select
              value={f.method}
              onValueChange={(v) => setF({ ...f, method: v as PaymentMethod })}
            >
              <SelectTrigger id="mi-m" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category" htmlFor="mi-c">
            <Input
              id="mi-c"
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
            />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}

export function PayoutsSection() {
  const live = useLive(subscribePayouts, [] as TrainerPayout[], []);
  const [trainer, setTrainer] = useState("all");
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const trainers = [
    ...new Map(live.data.map((p) => [p.trainerId, p.trainerNameSnapshot])).entries(),
  ];
  const byTrainer = live.data.filter((p) => trainer === "all" || p.trainerId === trainer);
  const rows = byTrainer.filter((p) => status === "all" || p.status === status);
  const pending = byTrainer
    .filter((p) => p.status === "pending")
    .reduce((a, p) => a + p.trainerShareAmount, 0);
  const paid = byTrainer
    .filter((p) => p.status === "paid")
    .reduce((a, p) => a + p.trainerShareAmount, 0);
  const mark = (p: TrainerPayout) =>
    void setPayoutStatus(p.id, "paid").then(
      () => toast.success("Marked as paid"),
      (e) => toast.error(firestoreErrorMessage(e)),
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={trainer} onValueChange={setTrainer}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Trainer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All trainers</SelectItem>
            {trainers.map(([id, n]) => (
              <SelectItem key={id} value={id}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1.5" role="tablist" aria-label="Payout status">
          {(
            [
              ["pending", "To pay"],
              ["paid", "Paid"],
              ["all", "All"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              role="tab"
              aria-selected={status === v}
              onClick={() => setStatus(v)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-semibold",
                status === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          metric={{
            id: "pending",
            label: "To pay trainers",
            value: formatPrice(pending),
            icon: Wallet,
            tone: "warning",
          }}
        />
        <StatCard
          metric={{
            id: "paid",
            label: "Paid to trainers",
            value: formatPrice(paid),
            icon: Wallet,
            tone: "success",
          }}
        />
      </div>
      {!rows.length ? (
        <EmptyState
          icon={Wallet}
          title={status === "pending" ? "Nothing to pay" : "No trainer payouts"}
          description="A payout is created automatically every time PT is sold."
        />
      ) : (
        <ul className="surface-card divide-y divide-border">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {p.trainerNameSnapshot} · {p.clientNameSnapshot}
                </p>
                <p className="text-meta">
                  {p.ptPackageNameSnapshot} · {formatDateISO(p.paymentDate)} · PT{" "}
                  {formatPrice(p.grossAmount)} → gym {formatPrice(p.gymShareAmount)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <b className="tabular-nums">{formatPrice(p.trainerShareAmount)}</b>
                <StatusPill
                  tone={
                    p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "danger"
                  }
                >
                  {p.status === "pending" ? "to pay" : p.status}
                </StatusPill>
                {p.status === "pending" ? (
                  <Button size="sm" variant="outline" onClick={() => mark(p)}>
                    <CheckCircle2 aria-hidden /> Mark paid
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
