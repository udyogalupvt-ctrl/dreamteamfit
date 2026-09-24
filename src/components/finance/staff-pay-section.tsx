import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, UserCog, Wallet } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
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
import { subscribePayments } from "@/services/finance.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeInvoices } from "@/services/invoices.service";
import {
  payStaff,
  setPaidLeaves,
  subscribeDayMarks,
  subscribePaidLeaves,
  subscribeStaff,
  subscribeStaffAttendance,
  subscribeStaffPayments,
  subscribeStaffPrivate,
} from "@/services/staff.service";
import { staffMonth, type DayMarkDoc, type StaffMonth } from "@/lib/staff-salary";
import {
  EXPENSE_PAYMENT_METHODS,
  type ExpensePaymentMethod,
  type Invoice,
  type Payment,
  type Staff,
  type StaffAttendanceEvent,
  type StaffPayment,
  type StaffPaymentKind,
  type StaffPrivate,
} from "@/types/models";

interface Row {
  staff: Staff;
  pay: StaffPrivate | undefined;
  collected: number;
  joinings: number;
  incentive: number;
  basis: string;
  salaryPaid: number;
  incentivePaid: number;
  /** Attendance-based salary for the month (monthly ÷ 30 per day). */
  month: StaffMonth;
}

/**
 * Salaries and counsellor incentives for a month. Incentive = % of money collected from members
 * the person counselled, or ₹ per joining / renewal they counselled (set on the Staff page).
 */
export function StaffPaySection() {
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const privates = useLive<StaffPrivate[]>(subscribeStaffPrivate, [], []);
  const payments = useLive<Payment[]>(subscribePayments, [], []);
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);
  const paid = useLive<StaffPayment[]>(subscribeStaffPayments, [], []);
  const events = useLive<StaffAttendanceEvent[]>(subscribeStaffAttendance, [], []);
  const marks = useLive<DayMarkDoc[]>(subscribeDayMarks, [], []);
  const leaves = useLive<Record<string, number>>(subscribePaidLeaves, {}, []);
  const today = todayISO();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [paying, setPaying] = useState<{ row: Row; kind: StaffPaymentKind } | null>(null);
  const monthLabel = format(new Date(`${month}-01T00:00:00`), "MMM yyyy");

  const rows = useMemo<Row[]>(
    () =>
      staff.data
        .filter((s) => s.active)
        .map((s) => {
          const pay = privates.data.find((p) => p.staffId === s.id);
          const collected = payments.data
            .filter((p) => p.counsellorId === s.id && p.paymentDate.startsWith(month))
            .reduce((n, p) => n + p.amount, 0);
          const joinings = invoices.data.filter(
            (i) =>
              i.counsellorId === s.id &&
              i.invoiceDate.startsWith(month) &&
              (i.membershipId || i.ptAssignmentId),
          ).length;
          const type = pay?.incentiveType ?? "none";
          const value = pay?.incentiveValue ?? 0;
          const incentive =
            type === "percentage"
              ? Math.round((collected * value) / 100)
              : type === "fixed"
                ? joinings * value
                : 0;
          const basis =
            type === "percentage"
              ? `${value}% of ${formatPrice(collected)} collected`
              : type === "fixed"
                ? `${joinings} joining${joinings === 1 ? "" : "s"} × ${formatPrice(value)}`
                : "No incentive set";
          const mine = paid.data.filter((p) => p.staffId === s.id && p.period === month);
          return {
            staff: s,
            pay,
            collected,
            joinings,
            incentive,
            basis,
            salaryPaid: mine.filter((p) => p.kind === "salary").reduce((n, p) => n + p.amount, 0),
            incentivePaid: mine
              .filter((p) => p.kind === "incentive")
              .reduce((n, p) => n + p.amount, 0),
            month: staffMonth(
              s.id,
              month,
              pay?.monthlySalary ?? 0,
              leaves.data[`${s.id}_${month}`] ?? 0,
              events.data,
              marks.data,
              today,
              s.joiningDate,
            ),
          };
        }),
    [
      staff.data,
      privates.data,
      payments.data,
      invoices.data,
      paid.data,
      month,
      events.data,
      marks.data,
      leaves.data,
      today,
    ],
  );

  if (staff.loading || privates.loading) return <LoadingRows rows={4} />;
  if (!rows.length)
    return (
      <EmptyState
        icon={UserCog}
        title="No staff yet"
        description="Add staff, their salary and incentive on the Staff page."
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta">
          Paying here also adds the expense, so profit and the cash book stay right.
        </p>
        <Input
          type="month"
          aria-label="Month"
          value={month}
          onChange={(e) => setMonth(e.target.value || todayISO().slice(0, 7))}
          className="w-auto"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const salary = r.month.payable;
          const m = r.month;
          return (
            <article key={r.staff.id} className="surface-card space-y-3 p-5">
              <div>
                <h3 className="text-card-title">{r.staff.name}</h3>
                <p className="text-meta">{r.staff.role || "Staff"}</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-muted/50 p-3">
                  <dt className="text-meta">Salary due · {monthLabel}</dt>
                  <dd className="font-bold tabular-nums">{formatPrice(salary)}</dd>
                  <dd className="text-meta">
                    {formatPrice(r.pay?.monthlySalary ?? 0)} ÷ 30 ={" "}
                    {formatPrice(Math.round(m.daySalary))}/day
                  </dd>
                  <dd className="text-meta">
                    {m.present} present · {m.half} half · {m.absent} absent
                    {m.leave ? ` · ${m.leave} leave` : ""}
                    {m.notJoined ? ` · joined ${formatDateISO(r.staff.joiningDate)}` : ""}
                  </dd>
                  {m.deduction ? (
                    <dd className="text-meta text-destructive">
                      − {formatPrice(m.deduction)} ({m.deductionDays} day
                      {m.deductionDays === 1 ? "" : "s"})
                    </dd>
                  ) : null}
                  <dd className="mt-1">
                    {r.salaryPaid >= salary && salary > 0 ? (
                      <StatusPill tone="success">Paid</StatusPill>
                    ) : r.salaryPaid > 0 ? (
                      <StatusPill tone="warning">Paid {formatPrice(r.salaryPaid)}</StatusPill>
                    ) : (
                      <StatusPill tone="warning">Not paid</StatusPill>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <dt className="text-meta">Incentive</dt>
                  <dd className="font-bold tabular-nums">{formatPrice(r.incentive)}</dd>
                  <dd className="text-meta">{r.basis}</dd>
                  {r.incentivePaid > 0 ? (
                    <dd className="mt-1">
                      <StatusPill tone="success">Paid {formatPrice(r.incentivePaid)}</StatusPill>
                    </dd>
                  ) : null}
                </div>
              </dl>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Paid leaves this month
                  <span className="text-meta block">Not deducted (0 unless you add)</span>
                </span>
                <Input
                  type="number"
                  min={0}
                  max={31}
                  className="h-9 w-20"
                  aria-label={`Paid leaves for ${r.staff.name}`}
                  defaultValue={m.paidLeaves}
                  key={`${r.staff.id}_${month}_${m.paidLeaves}`}
                  onBlur={(e) => {
                    const v = Number(e.target.value) || 0;
                    if (v !== m.paidLeaves)
                      void setPaidLeaves(r.staff.id, month, v).then(
                        () =>
                          toast.success(`${r.staff.name}: ${v} paid leave${v === 1 ? "" : "s"}`),
                        (err: unknown) => toast.error(firestoreErrorMessage(err)),
                      );
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPaying({ row: r, kind: "salary" })}>
                  <Wallet aria-hidden /> Pay salary
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={r.incentive - r.incentivePaid <= 0}
                  onClick={() => setPaying({ row: r, kind: "incentive" })}
                >
                  Pay incentive
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <PayDialog
        paying={paying}
        month={month}
        monthLabel={monthLabel}
        onClose={() => setPaying(null)}
      />
    </div>
  );
}

function PayDialog({
  paying,
  month,
  monthLabel,
  onClose,
}: {
  paying: { row: Row; kind: StaffPaymentKind } | null;
  month: string;
  monthLabel: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<ExpensePaymentMethod>("Cash");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState<typeof paying>(null);
  if (paying !== last) {
    setLast(paying);
    if (paying) {
      const r = paying.row;
      setAmount(
        paying.kind === "salary"
          ? Math.max(0, r.month.payable - r.salaryPaid)
          : Math.max(0, r.incentive - r.incentivePaid),
      );
      setMethod("Cash");
      setDate(todayISO());
      setNotes("");
    }
  }
  const save = async () => {
    if (!paying || !user) return;
    setSaving(true);
    try {
      await payStaff({
        staff: paying.row.staff,
        kind: paying.kind,
        period: month,
        periodLabel: monthLabel,
        amount,
        method,
        date,
        notes,
        by: { uid: user.uid, name: user.displayName || user.email || "Staff" },
      });
      toast.success(
        `${paying.kind === "salary" ? "Salary" : "Incentive"} paid to ${paying.row.staff.name}`,
        {
          description: `${formatPrice(amount)} · added to expenses`,
        },
      );
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={!!paying}
      onOpenChange={(o) => !o && onClose()}
      title={`${paying?.kind === "salary" ? "Pay salary" : "Pay incentive"} · ${paying?.row.staff.name ?? ""}`}
      description={`For ${monthLabel}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !(amount > 0)} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Pay{" "}
            {formatPrice(amount || 0)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount ₹" htmlFor="pay-amt">
          <Input
            id="pay-amt"
            type="number"
            min={1}
            inputMode="decimal"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </Field>
        <Field label="Paid by" htmlFor="pay-method">
          <Select value={method} onValueChange={(v) => setMethod(v as ExpensePaymentMethod)}>
            <SelectTrigger id="pay-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date" htmlFor="pay-date">
          <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="pay-note">
          <Input
            id="pay-note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
    </FormDialog>
  );
}
