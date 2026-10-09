import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cashPartOf, PayModeField } from "@/components/billing/pay-mode-field";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { SPLIT_MODE, splitParts, splitProblem, type PayMode, type PayPart } from "@/lib/split-pay";
import { getSplitParts } from "@/services/finance.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { editSplitPayment, splitChanges } from "@/services/payment-split.service";
import {
  cashOpenFrom,
  editPayment,
  paymentChanges,
  paymentDateRights,
  paymentEditRights,
} from "@/services/payment-edit.service";
import type { Payment, RecordEdit } from "@/types/models";

/** Logins that may correct this payment (today's: Billing; older: Income & expenses). */
export function usePaymentEditRights() {
  const { can } = useAccess();
  const rights = { billing: can("billing"), finance: can("finance") };
  return (p: Payment) => ({ ...paymentEditRights(p, rights), rights });
}

/**
 * "Edit payment": mode, amount, date and note, with the bill's balance shown before saving. A
 * Cash + UPI payment is edited as one payment (both parts; payment-split.service.ts).
 */
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
  const [method, setMethod] = useState<PayMode>("Cash");
  const [cashText, setCashText] = useState("");
  // Every part of this payment (one unless it is Cash + UPI); null while they load.
  const [group, setGroup] = useState<Payment[] | null>(null);
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
    setCashText("");
    if (!payment.splitId) {
      setGroup([payment]);
      return;
    }
    setGroup(null);
    let live = true;
    getSplitParts(payment.splitId).then(
      (parts) => {
        if (!live) return;
        const g = parts.some((x) => x.id === payment.id) ? parts : [payment];
        setGroup(g);
        if (g.length > 1) {
          setMethod(SPLIT_MODE);
          setCashText(
            String(g.filter((x) => x.method === "Cash").reduce((s, x) => s + x.amount, 0)),
          );
        }
      },
      () => live && setGroup([payment]),
    );
    return () => {
      live = false;
    };
  }, [payment]);
  if (!payment) return null;
  const p = payment;
  const r = rightsOf(p);
  const dateRights = paymentDateRights(p, r.rights);
  const parts = group ?? [p];
  const together = Math.round(parts.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  // Two parts now, or Cash + UPI chosen: the parts change together and the total stays the same.
  // (A part whose other part is gone keeps its link until it is saved this way.)
  const splitPath = method === SPLIT_MODE || parts.length > 1 || !!p.splitId;
  const splitBad = method === SPLIT_MODE ? splitProblem(together, cashPartOf(cashText)) : "";
  const target: PayPart[] =
    method !== SPLIT_MODE
      ? [{ method, amount: together }]
      : splitBad
        ? []
        : splitParts(together, cashPartOf(cashText));
  const n = amount.trim() === "" ? NaN : Number(amount);
  const form = {
    amount: Number.isFinite(n) ? n : p.amount,
    method: method === SPLIT_MODE ? p.method : method,
    paymentDate: date,
    note,
  };
  const changes = !group
    ? []
    : !splitPath
      ? paymentChanges(p, form)
      : target.length
        ? splitChanges(parts, target, date, note)
        : [];
  const less = !splitPath && Number.isFinite(n) && n < p.amount && p.kind !== "refund";

  const save = async () => {
    setError("");
    if (!splitPath && r.amount && !(Number.isFinite(n) && n > 0))
      return setError("Enter an amount above zero.");
    if (splitBad) return setError(splitBad);
    try {
      if (splitPath) {
        await editSplitPayment({
          payment: p,
          group: parts,
          target,
          paymentDate: date,
          note,
          reason,
          can: r.rights,
          by: user?.displayName || user?.email || "Staff",
        });
        onClose();
        toast.success("Payment updated", { description: changes.join(" · ") });
        return;
      }
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
          <Button onClick={() => save()} disabled={!changes.length || !group}>
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
                : splitPath
                  ? "Same total while it is in two modes. To change the total, choose one mode first."
                  : "The bill's paid and balance follow this."
            }
          >
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min={1}
              value={splitPath ? String(together) : amount}
              disabled={!r.amount || splitPath}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <PayModeField
          id="pay-method"
          mode={method}
          onMode={(m) => {
            // Cash + UPI keeps the total: an amount typed a moment ago goes back.
            if (m === SPLIT_MODE) setAmount(String(together));
            setMethod(m);
          }}
          cash={cashText}
          onCash={setCashText}
          total={together}
          error={splitBad && cashText.trim() !== "" ? splitBad : undefined}
          disabled={!r.money || !group}
          split={p.kind !== "refund" && !!p.invoiceId}
          withOther={p.method === "Other"}
        />
        <Field label="Date" htmlFor="pay-date" hint={dateRights.note || undefined}>
          <Input
            id="pay-date"
            type="date"
            min={cashOpenFrom()}
            max={todayISO()}
            value={date}
            disabled={!dateRights.allowed}
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
