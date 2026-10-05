import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  cashOpenFrom,
  editPayment,
  paymentChanges,
  paymentEditRights,
} from "@/services/payment-edit.service";
import { PAYMENT_METHODS, type Payment, type PaymentMethod, type RecordEdit } from "@/types/models";

/** Logins that may correct this payment (today's: Billing; older: Income & expenses). */
export function usePaymentEditRights() {
  const { can } = useAccess();
  const rights = { billing: can("billing"), finance: can("finance") };
  return (p: Payment) => ({ ...paymentEditRights(p, rights), rights });
}

/** "Edit payment": mode, amount, date and note, with the bill's balance shown before saving. */
export function EditPaymentDialog({
  payment,
  onClose,
}: {
  payment: Payment | null;
  onClose: () => void;
}) {
  const rightsOf = usePaymentEditRights();
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [payBy, setPayBy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!payment) return;
    setAmount(String(payment.amount));
    setMethod(payment.method);
    setDate(payment.paymentDate);
    setNote(payment.note);
    setReason("");
    setPayBy(todayISO());
    setError("");
  }, [payment]);
  if (!payment) return null;
  const p = payment;
  const r = rightsOf(p);
  const n = amount.trim() === "" ? NaN : Number(amount);
  const form = { amount: Number.isFinite(n) ? n : p.amount, method, paymentDate: date, note };
  const changes = paymentChanges(p, form);
  const less = Number.isFinite(n) && n < p.amount && p.kind !== "refund";

  const save = async () => {
    setError("");
    if (r.amount && !(Number.isFinite(n) && n > 0)) return setError("Enter an amount above zero.");
    try {
      await editPayment({
        payment: p,
        form,
        reason,
        can: r.rights,
        nextPaymentDate: less ? payBy : null,
        by: user?.displayName || user?.email || "Staff",
      });
      onClose();
      toast.success("Payment updated", { description: changes.join(" · ") });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={p.kind === "refund" ? "Edit refund" : "Edit payment"}
      description={`${p.clientNameSnapshot} · ${p.invoiceNumber || "no bill"} · taken ${formatDateISO(p.paymentDate)} by ${p.createdBy || "staff"}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save()} disabled={!changes.length}>
            <Pencil aria-hidden /> Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!r.money ? (
          <p className="rounded-xl bg-muted p-3 text-sm">
            Older than {formatDateISO(cashOpenFrom())}: that cash is already carried forward in the
            Day Book, so only the note can change.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Amount ₹"
            htmlFor="pay-amount"
            hint={
              p.kind === "refund"
                ? "To take a refund back, use Restore on the cancelled plan."
                : "The bill's paid and balance follow this."
            }
          >
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min={1}
              value={amount}
              disabled={!r.amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Paid by" htmlFor="pay-method">
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PaymentMethod)}
              disabled={!r.money}
            >
              <SelectTrigger id="pay-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((x) => (
                  <SelectItem key={x} value={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field
          label="Date"
          htmlFor="pay-date"
          hint={r.rights.finance ? undefined : "Changing the date needs Income & expenses."}
        >
          <Input
            id="pay-date"
            type="date"
            min={cashOpenFrom()}
            max={todayISO()}
            value={date}
            disabled={!r.money || !r.rights.finance}
            onChange={(e) => setDate(e.target.value)}
            className="max-w-48"
          />
        </Field>
        {less ? (
          <Field
            label="When will they pay the balance?"
            htmlFor="pay-by"
            hint={`${formatPrice(p.amount - n)} more becomes due on the bill.`}
          >
            <Input
              id="pay-by"
              type="date"
              min={todayISO()}
              value={payBy}
              onChange={(e) => setPayBy(e.target.value)}
              className="max-w-48"
            />
          </Field>
        ) : null}
        <Field label="Note (optional)" htmlFor="pay-note">
          <Input
            id="pay-note"
            maxLength={300}
            placeholder="e.g. UPI ref 4521"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Field label="Why the change? (optional)" htmlFor="pay-reason">
          <Input
            id="pay-reason"
            maxLength={300}
            placeholder="e.g. Was UPI, not cash"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {changes.length ? (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="font-semibold">Will change</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

/**
 * "Changed 6 Oct 2026 by Anil: Mode Cash → UPI (reason)" under a record: the latest change, and
 * the earlier ones on request.
 */
export function EditLines({ edits }: { edits: RecordEdit[] }) {
  const [all, setAll] = useState(false);
  if (!edits.length) return null;
  const shown = all ? [...edits].reverse() : edits.slice(-1);
  return (
    <span className="block">
      {shown.map((e, i) => (
        <span key={i} className="text-meta block">
          Changed {formatDateISO(e.on)} by {e.by}: {e.changes.join("; ")}
          {e.reason ? ` (${e.reason})` : ""}
        </span>
      ))}
      {edits.length > 1 ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="text-meta cursor-pointer font-semibold underline underline-offset-2"
        >
          {all
            ? "Show latest only"
            : `Show ${edits.length - 1} earlier change${edits.length > 2 ? "s" : ""}`}
        </button>
      ) : null}
    </span>
  );
}
