import { useMemo, useState } from "react";
import { format } from "date-fns";
import { HandCoins, Loader2, Wallet } from "lucide-react";
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
import { buildCashBook, type CashBookRow, type CashDay } from "@/lib/cash-book";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { subscribeExpenses } from "@/services/expenses.service";
import { saveCashDay, subscribeCashDays, subscribePayments } from "@/services/finance.service";
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
  const [editing, setEditing] = useState<CashBookRow | null>(null);
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
          <Button
            onClick={() =>
              setEditing(book.find((r) => r.date === today) ?? emptyRow(today, now?.closing ?? 0))
            }
          >
            <HandCoins aria-hidden /> Today&apos;s handover
          </Button>
        </div>
      </div>
      {!rows.length ? (
        <EmptyState
          icon={Wallet}
          title="No cash entries this month"
          description="Cash payments, cash expenses and handovers show here day by day."
          action={
            <Button variant="outline" onClick={() => setEditing(emptyRow(today, 0))}>
              Set opening cash
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
                      {r.handover
                        ? `${formatPrice(r.handover)}${r.handoverTo ? ` → ${r.handoverTo}` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatPrice(r.closing)}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
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
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
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
        row={editing}
        people={staff.data.map((s) => s.name)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

export const emptyRow = (date: string, opening: number): CashBookRow => ({
  date,
  opening,
  received: 0,
  expenses: 0,
  balance: opening,
  handover: 0,
  handoverTo: "",
  note: "",
  closing: opening,
});

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-meta">{k}</dt>
      <dd className="font-semibold tabular-nums">{v}</dd>
    </div>
  );
}

export function HandoverDialog({
  row,
  people,
  onClose,
}: {
  row: CashBookRow | null;
  people: string[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [handover, setHandover] = useState(0);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState("");
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState<CashBookRow | null>(null);
  if (row !== last) {
    setLast(row);
    if (row) {
      setHandover(row.handover);
      setTo(row.handoverTo);
      setNote(row.note);
      setOpening("");
    }
  }
  const save = async () => {
    if (!row) return;
    setSaving(true);
    try {
      await saveCashDay(
        {
          date: row.date,
          handover,
          handoverTo: to,
          note,
          openingOverride: opening.trim() === "" ? null : Number(opening),
        },
        user?.email ?? "staff",
      );
      toast.success("Cash book saved");
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={`Cash · ${row ? formatDateISO(row.date) : ""}`}
      description={row ? `Balance ${formatPrice(row.balance)} before handover` : ""}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Handover ₹"
          htmlFor="cb-hand"
          hint="Cash taken out of the drawer and given to the owner."
        >
          <Input
            id="cb-hand"
            type="number"
            min={0}
            inputMode="decimal"
            value={handover || ""}
            onChange={(e) => setHandover(Number(e.target.value))}
          />
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
        <Field
          label="Cash in the drawer this morning (opening)"
          htmlFor="cb-open"
          className="sm:col-span-2"
          hint="Leave empty: opening = yesterday's closing. Fill it on the first day you use the cash book."
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
      </div>
    </FormDialog>
  );
}
