import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { EditLines } from "@/components/billing/edit-payment-dialog";
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
import { useLive } from "@/hooks/use-live-query";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribePtPackages, subscribeTrainers } from "@/services/pt.service";
import { planEndDate } from "@/lib/plan-dates";
import { editPtPlan, ptChanges } from "@/services/pt-edit.service";
import { editBill, previewBillEdit, staffDiscountOf } from "@/services/bill-edit.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { formatDateISO, formatPrice } from "@/lib/format";
import type { Invoice, PaymentMethod, PtAssignment, ShareType, Trainer } from "@/types/models";

/**
 * "Edit PT plan": the trainer (owner: the share moves with it), the dates, the share, and the
 * discount on its bill (owner; like Edit bill: a member who paid more gets the extra back).
 */
export function EditPtDialog({
  pt,
  bill,
  onClose,
}: {
  pt: PtAssignment | null;
  bill: Invoice | null;
  onClose: () => void;
}) {
  const open = !!pt;
  const { can } = useAccess();
  const { user } = useAuth();
  const trainers = useLive<Trainer[]>(open ? subscribeTrainers : null, [], [open]);
  const ptPackages = useLive(open ? subscribePtPackages : null, [], [open]);
  const [oldPaid, setOldPaid] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [shareType, setShareType] = useState<ShareType>("percentage");
  const [shareValue, setShareValue] = useState("");
  const [reason, setReason] = useState("");
  const [discount, setDiscount] = useState("");
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("Cash");
  const [error, setError] = useState("");
  const settings = useLive(open ? subscribeBusinessSettings : null, DEFAULT_BILLING_SETTINGS, [
    open,
  ]);
  useEffect(() => {
    if (!pt) return;
    setDiscount("");
    setOldPaid("");
    setRefundMethod("Cash");
    setTrainerId(pt.trainerId);
    setStart(pt.startDate);
    setEnd(pt.endDate);
    setShareType(pt.trainerShareType);
    setShareValue(String(pt.trainerShareValue));
    setReason("");
    setError("");
  }, [pt]);
  const choices = useMemo(() => {
    const list = trainers.data
      .filter((t) => t.status === "active" || t.id === pt?.trainerId)
      .map((t) => ({ id: t.id, name: t.name }));
    if (pt && !list.some((t) => t.id === pt.trainerId))
      list.unshift({ id: pt.trainerId, name: pt.trainerNameSnapshot });
    return list;
  }, [trainers.data, pt]);
  if (!pt) return null;
  const money = can("finance");
  const trainer = choices.find((t) => t.id === trainerId) ?? {
    id: pt.trainerId,
    name: pt.trainerNameSnapshot,
  };
  const shareNumber = shareValue.trim() === "" ? Number.NaN : Number(shareValue);
  const form = {
    trainer,
    startDate: start,
    endDate: end,
    share: money ? { type: shareType, value: shareNumber } : undefined,
    oldPaid: oldPaid.trim() === "" ? undefined : Number(oldPaid),
  };
  // Like gym plans: the usual end is calendar months from the start (the package's length).
  const pkgDays = ptPackages.data.find((x) => x.id === pt.ptPackageId)?.durationDays ?? 0;
  const usual = pkgDays && /^\d{4}-\d{2}-\d{2}$/.test(start) ? planEndDate(start, pkgDays) : "";
  const extraDays =
    usual && end
      ? Math.round(
          (new Date(`${end}T00:00:00`).getTime() - new Date(`${usual}T00:00:00`).getTime()) /
            86_400_000,
        )
      : 0;
  const changeStart = (v: string) => {
    setStart(v);
    if (pkgDays && /^\d{4}-\d{2}-\d{2}$/.test(v)) setEnd(planEndDate(v, pkgDays));
  };
  const shareBad =
    money &&
    (!(shareNumber >= 0) ||
      (shareType === "percentage" && shareNumber > 100) ||
      (shareType !== "percentage" && shareNumber > pt.ptPrice));
  const planChanges = ptChanges(pt, form);
  // The discount on the PT plan's bill (a plan paid in the old software has none here).
  const discountEditable =
    !!bill &&
    !pt.paidInOldSoftware &&
    bill.paymentStatus !== "closed" &&
    bill.paymentStatus !== "refunded";
  const billDiscount = bill ? staffDiscountOf(bill) : 0;
  const billForm =
    bill && discountEditable && discount.trim() !== ""
      ? { discount: Number(discount), dueDate: bill.dueDate, notes: bill.notes }
      : null;
  const billPv = bill && billForm ? previewBillEdit(bill, billForm, settings.data) : null;
  const discountChanged = !!billPv?.discountChanged;
  const changes = [...planChanges, ...(discountChanged ? (billPv?.changes ?? []) : [])];

  const save = async () => {
    setError("");
    const by = user?.displayName || user?.email || "Staff";
    try {
      if (planChanges.length) await editPtPlan({ pt, form, reason, canFinance: money, by });
      if (discountChanged && bill && billForm)
        await editBill({
          invoice: bill,
          form: billForm,
          settings: settings.data,
          reason: reason || "PT discount",
          canDiscount: money,
          by,
          byUid: user?.uid ?? "",
          refundMethod,
        });
      onClose();
      toast.success("PT plan updated", {
        description:
          billPv?.refund && discountChanged
            ? `${formatPrice(billPv.refund)} recorded as money given back.`
            : changes.join(" · "),
      });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit PT plan"
      description={`${pt.ptPackageNameSnapshot} for ${pt.clientNameSnapshot} · PT price ${formatPrice(pt.ptPrice)}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => save()}
            disabled={!changes.length || shareBad || !!billPv?.error || (discountChanged && !money)}
          >
            <Pencil aria-hidden /> Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="Trainer"
          htmlFor="pt-trainer"
          hint={
            money
              ? "Their unpaid share for this plan moves to the new trainer."
              : "Changing the trainer moves their share: it needs Income & expenses (the owner)."
          }
        >
          <Select value={trainer.id} onValueChange={setTrainerId} disabled={!money}>
            <SelectTrigger id="pt-trainer" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="pt-start">
            <Input
              id="pt-start"
              type="date"
              value={start}
              onChange={(e) => changeStart(e.target.value)}
            />
          </Field>
          <Field
            label="End date"
            htmlFor="pt-end"
            hint={
              !usual
                ? undefined
                : extraDays === 0
                  ? `${pkgDays} days`
                  : `${extraDays > 0 ? `${extraDays} extra` : `${-extraDays} fewer`} day${Math.abs(extraDays) === 1 ? "" : "s"} than usual (${formatDateISO(usual)})`
            }
          >
            <Input
              id="pt-end"
              type="date"
              min={start || undefined}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            {usual && extraDays !== 0 ? (
              <button
                type="button"
                className="cursor-pointer justify-self-start text-sm font-semibold underline underline-offset-2"
                onClick={() => setEnd(usual)}
              >
                Use {formatDateISO(usual)}
              </button>
            ) : null}
          </Field>
        </div>
        <Field
          label="Trainer's share"
          htmlFor="pt-share"
          hint={
            !money
              ? "Changing the share needs Income & expenses (the owner)."
              : shareBad
                ? shareType === "percentage"
                  ? "Enter 0 to 100 %."
                  : `Enter ₹0 to ${formatPrice(pt.ptPrice)}.`
                : "Their unpaid payout for this plan and the bill's trainer total follow."
          }
        >
          <div className="flex gap-2">
            <Select
              value={shareType}
              onValueChange={(v) => setShareType(v as ShareType)}
              disabled={!money}
            >
              <SelectTrigger className="w-28" aria-label="Share type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">%</SelectItem>
                <SelectItem value="fixed">₹ fixed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="pt-share"
              type="number"
              inputMode="decimal"
              min={0}
              disabled={!money}
              value={shareValue}
              onChange={(e) => setShareValue(e.target.value)}
              className="max-w-36 tabular-nums"
            />
          </div>
        </Field>
        {pt.paidInOldSoftware ? (
          <Field
            label="Paid in the old software (₹)"
            htmlFor="pt-oldpaid"
            hint="What they paid there for this PT plan (their old bill). Not counted in this app's money."
          >
            <Input
              id="pt-oldpaid"
              type="number"
              inputMode="numeric"
              min={0}
              step="1"
              placeholder="0"
              value={oldPaid === "" ? String(pt.oldSoftwarePaid ?? "") : oldPaid}
              onChange={(e) => setOldPaid(e.target.value === "" ? "0" : e.target.value)}
              className="max-w-48 tabular-nums"
            />
          </Field>
        ) : null}
        {discountEditable && bill ? (
          <Field
            label="Discount (₹)"
            htmlFor="pt-discount"
            error={billPv?.error || undefined}
            hint={
              !money
                ? "Only the owner's login (Income & expenses) can change a discount."
                : `On bill ${bill.invoiceNumber} (total ${formatPrice(bill.total)}, paid ${formatPrice(bill.amountPaid)}). If they paid more than the new total, the extra is given back.`
            }
          >
            <Input
              id="pt-discount"
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              disabled={!money}
              value={discount === "" ? String(billDiscount) : discount}
              onChange={(e) => setDiscount(e.target.value === "" ? "0" : e.target.value)}
              className="max-w-48 tabular-nums"
            />
          </Field>
        ) : null}
        {discountChanged && (billPv?.refund ?? 0) > 0 ? (
          <Field label={`Give back ${formatPrice(billPv?.refund ?? 0)} by`} htmlFor="pt-refund">
            <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as PaymentMethod)}>
              <SelectTrigger id="pt-refund" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["Cash", "UPI", "Card", "Bank Transfer"] as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label="Why the change? (optional)" htmlFor="pt-reason">
          <Input
            id="pt-reason"
            maxLength={300}
            placeholder="e.g. Member moved to the evening trainer"
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
        <EditLines edits={pt.edits} />
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
