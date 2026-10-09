import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { RemindOldBalance } from "@/components/clients/add-old-plan-dialog";
import { formatDateISO, formatPrice } from "@/lib/format";
import { isOldBalanceBill } from "@/lib/old-money";
import { editBill, previewBillEdit, staffDiscountOf } from "@/services/bill-edit.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  PAYMENT_METHODS,
  type BusinessBillingSettings,
  type Invoice,
  type PaymentMethod,
} from "@/types/models";
import { EditLines } from "./edit-payment-dialog";

/** "Edit bill": discount (owner), pay-by date and note. Items come from the plan (Edit plan). */
export function EditBillDialog({
  invoice: i,
  settings,
  onClose,
}: {
  invoice: Invoice;
  settings: BusinessBillingSettings;
  onClose: () => void;
}) {
  const { can } = useAccess();
  const { user } = useAuth();
  const money = can("finance");
  const [discount, setDiscount] = useState(String(staffDiscountOf(i)));
  const [dueDate, setDueDate] = useState(i.dueDate);
  const [notes, setNotes] = useState(i.notes);
  const oldBalanceBill = isOldBalanceBill(i);
  const [remind, setRemind] = useState(i.remindOldBalance === true);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [error, setError] = useState("");
  const d = discount.trim() === "" ? 0 : Number(discount);
  const form = {
    discount: Number.isFinite(d) ? d : -1,
    dueDate,
    notes,
    ...(oldBalanceBill ? { remindOldBalance: remind } : {}),
  };
  const pv = previewBillEdit(i, form, settings);
  const fromPlan = !!(i.membershipId || i.ptAssignmentId);

  const save = async () => {
    setError("");
    try {
      await editBill({
        invoice: i,
        form,
        settings,
        reason,
        canDiscount: money,
        by: user?.displayName || user?.email || "Staff",
        byUid: user?.uid ?? "",
        refundMethod: method,
      });
      onClose();
      toast.success(`Bill ${i.invoiceNumber} updated`, {
        description: pv.refund
          ? `${formatPrice(pv.refund)} recorded as money given back.`
          : pv.changes.join(" · "),
      });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit bill ${i.invoiceNumber}`}
      description={`${i.clientNameSnapshot} · ${formatDateISO(i.invoiceDate)} · ${i.items.map((x) => x.name).join(", ")}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save()} disabled={!pv.changes.length || !!pv.error}>
            <Pencil aria-hidden /> Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {fromPlan ? (
          <p className="rounded-xl bg-muted p-3 text-sm">
            Wrong package or dates? Use <b>Edit</b> on the member's Plan tab: the bill follows.
          </p>
        ) : null}
        <Field
          label="Discount ₹"
          htmlFor="bill-discount"
          hint={
            money
              ? i.upgradeCredit > 0
                ? `Upgrade credit of ${formatPrice(i.upgradeCredit)} stays on the bill.`
                : undefined
              : "Changing a discount needs Income & expenses (the owner)."
          }
        >
          <Input
            id="bill-discount"
            type="number"
            min={0}
            inputMode="decimal"
            value={discount}
            disabled={!money}
            onChange={(e) => setDiscount(e.target.value)}
            className="max-w-48"
          />
        </Field>
        {pv.discountChanged && !pv.error ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-xl border border-border p-3 text-sm tabular-nums">
            <dt className="text-muted-foreground">Total</dt>
            <dd>
              {formatPrice(i.total)} → <b>{formatPrice(pv.totals.total)}</b>
            </dd>
            <dt className="text-muted-foreground">Paid</dt>
            <dd>{formatPrice(i.amountPaid)}</dd>
            <dt className="text-muted-foreground">Balance due</dt>
            <dd>
              {formatPrice(i.balanceDue)} → <b>{formatPrice(pv.balance)}</b>
            </dd>
          </dl>
        ) : null}
        {pv.refund > 0 ? (
          <div className="grid gap-2 rounded-lg bg-info/10 p-3 text-sm">
            <p>
              They already paid <b>{formatPrice(pv.refund)}</b> more than the new total. It is
              recorded as money given back (Day Book shows it).
            </p>
            <Field label="Given back by" htmlFor="bill-refund-method">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="bill-refund-method" className="w-full sm:w-48">
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
        ) : null}
        {pv.balance > 0 ? (
          <Field
            label="Member will pay the balance on"
            htmlFor="bill-due"
            hint={
              oldBalanceBill && !remind && i.amountPaid <= 0
                ? "No WhatsApp reminder until the balance is confirmed (below)."
                : "The payment reminder goes out that morning."
            }
          >
            <Input
              id="bill-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="max-w-48"
            />
          </Field>
        ) : null}
        {oldBalanceBill && pv.balance > 0 ? (
          <RemindOldBalance id="bill-remind-old" checked={remind} onChange={setRemind} />
        ) : null}
        <Field label="Note on the bill" htmlFor="bill-notes">
          <Textarea
            id="bill-notes"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Field label="Why the change? (optional)" htmlFor="bill-reason">
          <Input
            id="bill-reason"
            maxLength={300}
            placeholder="e.g. Promised to pay on Friday"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {pv.changes.length ? (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="font-semibold">Will change</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {pv.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <EditLines edits={i.edits} />
        {pv.error || error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {pv.error || error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
