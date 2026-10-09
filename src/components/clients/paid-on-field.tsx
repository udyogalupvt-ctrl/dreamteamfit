import { useEffect, useState } from "react";
import { Field } from "@/components/common/form-dialog";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { subscribeClientPayments } from "@/services/finance.service";
import { cashOpenFrom, editPayment, paymentDateRights } from "@/services/payment-edit.service";
import { editSplitPayment } from "@/services/payment-split.service";
import type { Invoice, Payment } from "@/types/models";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Paid on" in Edit plan / Edit PT plan: the day the plan's checkout payment counts on, corrected
 * in place (same rules as Edit payment: the front desk a payment typed in today, the owner any day
 * the Day Book still has open). A payment made on the plan's first day follows a corrected start
 * day, unless staff pick another day. A Cash + UPI checkout moves both parts.
 */
export function usePaidOn(input: {
  open: boolean;
  clientId: string;
  bill: Pick<Invoice, "id"> | null;
  /** The plan's start day as saved, and as it is in the form now. */
  savedStart: string;
  start: string;
}) {
  const { can } = useAccess();
  const pays = useLive<Payment[]>(
    input.open && input.clientId
      ? (ok, fail) => subscribeClientPayments(input.clientId, ok, fail)
      : null,
    [],
    [input.open, input.clientId],
  );
  // "" = not picked by staff (the saved day, or the start day it follows).
  const [picked, setPicked] = useState("");
  useEffect(() => setPicked(""), [input.open, input.bill?.id]);
  const billId = input.bill?.id ?? "";
  const initial = billId
    ? pays.data.filter((p) => !p.oldSoftware && p.kind === "initial" && p.invoiceId === billId)
    : [];
  const payment = initial.find((p) => p.splitId && p.id === p.splitId) ?? initial[0] ?? null;
  // Cash + UPI: both parts, moved together.
  const group = payment?.splitId
    ? initial
        .filter((p) => p.splitId === payment.splitId)
        .sort((a, b) => (a.method === "UPI" ? -1 : 0) - (b.method === "UPI" ? -1 : 0))
    : payment
      ? [payment]
      : [];
  const who = { billing: can("billing"), finance: can("finance") };
  const rights = payment ? paymentDateRights(payment, who) : { allowed: false, note: "" };
  const today = todayISO();
  const openFrom = cashOpenFrom(today);
  const follows =
    !!payment &&
    rights.allowed &&
    !picked &&
    payment.paymentDate === input.savedStart &&
    input.start !== input.savedStart &&
    ISO.test(input.start) &&
    input.start <= today &&
    input.start >= openFrom;
  const value = !payment
    ? ""
    : !rights.allowed
      ? payment.paymentDate
      : picked || (follows ? input.start : payment.paymentDate);
  const changed = !!payment && value !== payment.paymentDate;
  const problem = !changed
    ? ""
    : !ISO.test(value)
      ? "Pick the day it was paid"
      : value > today
        ? "Can't be after today"
        : value < openFrom
          ? `Pick a day from ${formatDateISO(openFrom)} on`
          : "";
  return {
    payment,
    group,
    loading: pays.loading,
    rights,
    value,
    follows,
    setValue: setPicked,
    changed,
    problem,
    /** The line for "Will change". */
    change:
      changed && payment
        ? `Paid on ${formatDateISO(payment.paymentDate)} → ${formatDateISO(value)}`
        : "",
    /** Saves the new day (nothing when unchanged). */
    save: async (reason: string, by: string) => {
      if (!changed || !payment) return;
      if (group.length > 1) {
        await editSplitPayment({
          payment,
          group,
          target: group.map((x) => ({ method: x.method, amount: x.amount })),
          paymentDate: value,
          note: payment.note,
          reason: reason || "Paid on corrected",
          can: who,
          by,
        });
        return;
      }
      await editPayment({
        payment,
        form: {
          amount: payment.amount,
          method: payment.method,
          paymentDate: value,
          note: payment.note,
        },
        reason: reason || "Paid on corrected",
        can: who,
        nextPaymentDate: null,
        by,
      });
    },
  };
}

export function PaidOnField({ id, paidOn }: { id: string; paidOn: ReturnType<typeof usePaidOn> }) {
  const p = paidOn.payment;
  if (!p) return null;
  return (
    <Field
      label="Paid on"
      htmlFor={id}
      error={paidOn.problem || undefined}
      hint={
        paidOn.rights.allowed
          ? `${
              paidOn.group.length > 1
                ? paidOn.group.map((x) => `${x.method} ${formatPrice(x.amount)}`).join(" + ")
                : `${formatPrice(p.amount)} by ${p.method}`
            }${p.invoiceNumber ? ` · bill ${p.invoiceNumber}` : ""}. ${
              paidOn.follows
                ? "Moves with the start date (paid the day the plan started)."
                : "Counted in Collected on this day."
            }`
          : paidOn.rights.note
      }
    >
      <Input
        id={id}
        type="date"
        min={cashOpenFrom()}
        max={todayISO()}
        value={paidOn.value}
        disabled={!paidOn.rights.allowed}
        onChange={(e) => paidOn.setValue(e.target.value)}
        className="max-w-48"
      />
    </Field>
  );
}
