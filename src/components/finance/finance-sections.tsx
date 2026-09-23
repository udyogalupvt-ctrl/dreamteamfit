import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { StatCard } from "@/components/common/stat-card";
import { StatusPill } from "@/components/common/status-pill";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { addManualIncome, buildFinanceSummary, setPayoutStatus, subscribeManualIncome, subscribePayments, subscribePayouts } from "@/services/finance.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { subscribeExpenses } from "@/services/expenses.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { PAYMENT_METHODS, type Expense, type Invoice, type ManualIncome, type Payment, type PaymentMethod, type TrainerPayout } from "@/types/models";

export function IncomeSection() {
  const { user } = useAuth();
  const payments = useLive(subscribePayments, [] as Payment[], []);
  const invoices = useLive(subscribeInvoices, [] as Invoice[], []);
  const manual = useLive(subscribeManualIncome, [] as ManualIncome[], []);
  const expenses = useLive(subscribeExpenses, [] as Expense[], []);
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(todayISO());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", category: "Other", amount: "", method: "Cash" as PaymentMethod, date: todayISO(), notes: "" });
  const s = useMemo(() => buildFinanceSummary(payments.data, invoices.data, manual.data, expenses.data.map((e) => ({ amount: e.amount, date: e.date })), from, to), [payments.data, invoices.data, manual.data, expenses.data, from, to]);
  const save = async () => {
    const amount = Number(f.amount);
    if (f.title.trim().length < 2 || !(amount > 0)) return toast.error("Enter a title and a positive amount");
    try { await addManualIncome({ ...f, title: f.title.trim(), amount, createdBy: user?.displayName || user?.email || "Staff" }); toast.success("Income recorded"); setOpen(false); } catch (e) { toast.error(firestoreErrorMessage(e)); }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="fi-from"><Input id="fi-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="fi-to"><Input id="fi-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button className="ml-auto" onClick={() => setOpen(true)}><Plus /> Other income</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard metric={{ id: "Gross collected", label: "Gross collected", value: formatPrice(s.gross), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "Membership income", label: "Membership income", value: formatPrice(s.membershipIncome), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "PT gross", label: "PT gross", value: formatPrice(s.ptGross), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "PT gym share", label: "PT gym share", value: formatPrice(s.ptGymIncome), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "Trainer payable (excluded)", label: "Trainer payable (excluded)", value: formatPrice(s.trainerPayable), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "Other income", label: "Other income", value: formatPrice(s.otherIncome + s.manualIncome), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "Expenses", label: "Expenses", value: formatPrice(s.expenses), icon: Wallet, tone: "primary" }} />
        <StatCard metric={{ id: "Net profit", label: "Net profit", value: formatPrice(s.net), icon: Wallet, tone: "primary" }} />
      </div>
      <p className="text-meta">Gym income = membership + PT gym share + other income. Trainer shares are not counted as gym income.</p>
      <FormDialog open={open} onOpenChange={setOpen} title="Record other income" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="mi-t" required className="sm:col-span-2"><Input id="mi-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Supplement sale" /></Field>
          <Field label="Amount ₹" htmlFor="mi-a" required><Input id="mi-a" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" htmlFor="mi-d"><Input id="mi-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Method" htmlFor="mi-m"><Select value={f.method} onValueChange={(v) => setF({ ...f, method: v as PaymentMethod })}><SelectTrigger id="mi-m" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Category" htmlFor="mi-c"><Input id="mi-c" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        </div>
      </FormDialog>
    </div>
  );
}

export function PayoutsSection() {
  const live = useLive(subscribePayouts, [] as TrainerPayout[], []);
  const [trainer, setTrainer] = useState("all");
  const trainers = [...new Map(live.data.map((p) => [p.trainerId, p.trainerNameSnapshot])).entries()];
  const rows = live.data.filter((p) => trainer === "all" || p.trainerId === trainer);
  const pending = rows.filter((p) => p.status === "pending").reduce((a, p) => a + p.trainerShareAmount, 0);
  const paid = rows.filter((p) => p.status === "paid").reduce((a, p) => a + p.trainerShareAmount, 0);
  const mark = (p: TrainerPayout) => void setPayoutStatus(p.id, "paid").then(() => toast.success("Marked paid"), (e) => toast.error(firestoreErrorMessage(e)));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Select value={trainer} onValueChange={setTrainer}><SelectTrigger className="w-56" aria-label="Trainer"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All trainers</SelectItem>{trainers.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><StatCard metric={{ id: "Pending payouts", label: "Pending payouts", value: formatPrice(pending), icon: Wallet, tone: "primary" }} /><StatCard metric={{ id: "Paid payouts", label: "Paid payouts", value: formatPrice(paid), icon: Wallet, tone: "primary" }} /></div>
      {!rows.length ? <EmptyState icon={Wallet} title="No trainer payouts" description="Payouts appear automatically when PT is sold." /> : (
        <ul className="surface-card divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0"><p className="font-semibold">{p.trainerNameSnapshot} · {p.clientNameSnapshot}</p><p className="text-meta">{p.ptPackageNameSnapshot} · {formatDateISO(p.paymentDate)} · gross {formatPrice(p.grossAmount)} · gym {formatPrice(p.gymShareAmount)}</p></div>
              <div className="flex items-center gap-2"><b>{formatPrice(p.trainerShareAmount)}</b><StatusPill tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "danger"}>{p.status}</StatusPill>{p.status === "pending" ? <Button size="sm" variant="outline" onClick={() => mark(p)}><CheckCircle2 /> Mark paid</Button> : null}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
