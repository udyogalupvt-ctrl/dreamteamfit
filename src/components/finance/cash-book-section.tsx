import { useMemo, useState } from "react";
import { format } from "date-fns";
import { HandCoins, Loader2, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { LoadingRows } from "@/components/common/loading-state";
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
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import {
  buildCashBook,
  handoverSummary,
  type CashBookRow,
  type CashDay,
  type HandoverEntry,
} from "@/lib/cash-book";
import { addDaysISO, formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo-toast";
import { subscribeExpenses } from "@/services/expenses.service";
import {
  addHandover,
  putHandover,
  removeHandover,
  saveOpeningCash,
  subscribeCashDays,
  subscribePayments,
} from "@/services/finance.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeStaff } from "@/services/staff.service";
import type { Expense, Payment, Staff } from "@/types/models";

/** Daily cash: opening balance, cash received, cash expenses, balance, handover. */
export function CashBookSection() {
  const payments = useLive<Payment[]>(subscribePayments, [], []);
  const expenses = useLive<Expense[]>(subscribeExpenses, [], []);
  const days = useLive<CashDay[]>(subscribeCashDays, [], []);
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [editing, setEditing] = useState<string | null>(null);
  const today = todayISO();

  const book = useMemo(
    () => buildCashBook(payments.data, [], expenses.data, days.data, today),
    [payments.data, expenses.data, days.data, today],
  );
  const rows = book.filter((r) => r.date.startsWith(month)).reverse();
  const now = book[book.length - 1];
  const loading = payments.loading || expenses.loading || days.loading;
  const error = payments.error ?? expenses.error ?? days.error;

  if (loading) return <LoadingRows rows={5} />;
  if (error) return <ErrorState error={error} title="Couldn't load the cash book" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="surface-card flex items-center gap-3 p-4">
          <Wallet className="size-5 text-success" aria-hidden />
          <div>
            <p className="text-meta">Cash in the drawer now</p>
            <p className="text-stat tabular-nums">{formatPrice(now?.closing ?? 0)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value || today.slice(0, 7))}
            className="w-auto"
          />
          <Button onClick={() => setEditing(today)}>
            <HandCoins aria-hidden /> Record handover
          </Button>
        </div>
      </div>
      {!rows.length ? (
        <EmptyState
          icon={Wallet}
          title="No cash entries this month"
          description="Cash payments, cash expenses and handovers show here day by day."
          action={
            <Button variant="outline" onClick={() => setEditing(today)}>
              Record handover / opening cash
            </Button>
          }
        />
      ) : (
        <>
          <div className="surface-card hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Cash received</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Handover</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="whitespace-nowrap font-semibold">
                      {format(new Date(`${r.date}T00:00:00`), "dd MMM, EEE")}
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
                      {r.handovers.length ? handoverSummary(r) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatPrice(r.closing)}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r.date)}>
                        Handover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-3 md:hidden">
            {rows.map((r) => (
              <li key={r.date} className="surface-card space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{formatDateISO(r.date)}</p>
                  <Button size="sm" variant="outline" onClick={() => setEditing(r.date)}>
                    Handover
                  </Button>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <Cell k="Opening" v={formatPrice(r.opening)} />
                  <Cell k="Received" v={`+${formatPrice(r.received)}`} />
                  <Cell k="Expenses" v={`−${formatPrice(r.expenses)}`} />
                  <Cell k="Balance" v={formatPrice(r.balance)} />
                  <Cell k="Handover" v={r.handover ? formatPrice(r.handover) : "—"} />
                  <Cell k="Closing" v={formatPrice(r.closing)} />
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <HandoverDialog
        date={editing}
        book={book}
        people={staff.data.map((s) => s.name)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-meta">{k}</dt>
      <dd className="font-semibold tabular-nums">{v}</dd>
    </div>
  );
}

export function HandoverDialog({
  date,
  book,
  people,
  onClose,
  showOpening = false,
}: {
  /** Opens on this day's cash; null = closed. */
  date: string | null;
  /** The cash book worked out up to today (to show each day's balance). */
  book: CashBookRow[];
  people: string[];
  onClose: () => void;
  /** Open with the opening-cash box shown (the drawer cash was never entered). */
  showOpening?: boolean;
}) {
  const { user } = useAuth();
  const by = user?.displayName || user?.email || "staff";
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState("");
  const [openingOpen, setOpeningOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<string | null>(null);
  if (date !== last) {
    setLast(date);
    if (date) {
      setDay(date);
      setAmount("");
      setTo("");
      setNote("");
      setOpening("");
      setOpeningOpen(showOpening);
      setError("");
    }
  }
  const row = book.find((r) => r.date === day) ?? null;
  const left = row ? Math.max(0, row.balance - row.handover) : 0;
  const typed = Number(amount);

  const save = async () => {
    setError("");
    const openingValue = opening.trim() === "" ? null : Number(opening);
    if (!typed && openingValue === null) return setError("Enter the amount handed over.");
    if (amount.trim() && !(typed > 0)) return setError("Enter an amount above zero.");
    if (openingValue !== null && !(openingValue >= 0))
      return setError("Opening cash can't be below zero.");
    setSaving(true);
    try {
      if (openingValue !== null) await saveOpeningCash(day, openingValue, by);
      if (typed > 0) {
        const entry = await addHandover(day, { amount: typed, to, note }, by);
        toastWithUndo(
          `${formatPrice(typed)} handover saved on the cash of ${formatDateISO(day)}`,
          () => removeHandover(day, entry.id, by),
          day === today
            ? "Cash in hand goes down by this amount."
            : `Given today. ${formatDateISO(day)}'s closing and the opening of the days after it go down by this amount.`,
        );
      } else toast.success("Opening cash saved");
      onClose();
    } catch (e) {
      setError(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (h: HandoverEntry) => {
    try {
      await removeHandover(day, h.id, by);
      toastWithUndo(`${formatPrice(h.amount)} handover removed`, () => putHandover(day, h, by));
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open={!!date}
      onOpenChange={(o) => !o && onClose()}
      title="Cash handover"
      description="Cash taken out of the drawer and given to the owner. Pick the day the cash is from: yesterday's cash given today is booked on yesterday."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Field label="Cash of which day?" htmlFor="cb-day">
          <div className="flex flex-wrap items-center gap-2">
            {[
              [today, "Today"],
              [yesterday, "Yesterday"],
            ].map(([d, label]) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={day === d ? "default" : "outline"}
                aria-pressed={day === d}
                onClick={() => setDay(d!)}
              >
                {label}
              </Button>
            ))}
            <Input
              id="cb-day"
              type="date"
              max={today}
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="w-auto"
            />
          </div>
        </Field>

        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <p className="font-semibold">Cash of {formatDateISO(day)}</p>
          {row ? (
            <>
              <p className="text-meta mt-1 tabular-nums">
                Opening {formatPrice(row.opening)} + received {formatPrice(row.received)} − expenses{" "}
                {formatPrice(row.expenses)} = <b>{formatPrice(row.balance)}</b>
              </p>
              <p className="mt-1 tabular-nums">
                Handed over {formatPrice(row.handover)} · left in the drawer{" "}
                <b>{formatPrice(row.balance - row.handover)}</b>
              </p>
            </>
          ) : (
            <p className="text-meta mt-1">No cash recorded for this day in the period shown.</p>
          )}
          {row?.handovers.length ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
              {row.handovers.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <b className="tabular-nums">{formatPrice(h.amount)}</b>
                    {h.to ? ` → ${h.to}` : ""}
                    <span className="text-meta block truncate">
                      {[
                        h.givenOn && h.givenOn !== day
                          ? `given ${formatDateISO(h.givenOn)}`
                          : "given the same day",
                        h.note,
                        h.by ? `by ${h.by}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Remove the ${formatPrice(h.amount)} handover`}
                    onClick={() => void remove(h)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount handed over ₹" htmlFor="cb-hand">
            <div className="flex gap-2">
              <Input
                id="cb-hand"
                type="number"
                min={0}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {left > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setAmount(String(left))}
                >
                  All {formatPrice(left)}
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Given to" htmlFor="cb-to">
            <Input
              id="cb-to"
              list="cb-people"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Owner"
            />
            <datalist id="cb-people">
              {["Owner", ...people].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Note" htmlFor="cb-note" className="sm:col-span-2">
            <Input
              id="cb-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>
        {row && typed > row.balance - row.handover ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            This is more than the {formatPrice(Math.max(0, row.balance - row.handover))} left from
            the cash of {formatDateISO(day)}. Check the day.
          </p>
        ) : null}
        {day !== today && typed > 0 ? (
          <p className="text-meta">
            Booked on the cash of {formatDateISO(day)}, given today ({formatDateISO(today)}).
          </p>
        ) : null}

        {openingOpen ? (
          <Field
            label={`Cash in the drawer at the start of ${formatDateISO(day)} (opening)`}
            htmlFor="cb-open"
            hint="Leave empty: opening = the day before's closing. Fill it on the first day you use the cash book, or to correct it."
          >
            <Input
              id="cb-open"
              type="number"
              min={0}
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder={row ? String(row.opening) : ""}
            />
          </Field>
        ) : (
          <button
            type="button"
            className="text-meta justify-self-start underline"
            onClick={() => setOpeningOpen(true)}
          >
            Set the opening cash of this day
          </button>
        )}
      </div>
    </FormDialog>
  );
}
