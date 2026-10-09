import { useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  IndianRupee,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Printer,
  Send,
  Trash2,
} from "lucide-react";
import { toastWithUndo } from "@/lib/undo-toast";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { useBin } from "@/hooks/use-bin";
import { binBill } from "@/services/recycle-bin.service";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { manualWhatsAppUrl } from "@/lib/invoice-share";
import { formatDateISO, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, type Invoice, type PaymentMethod } from "@/types/models";
import { autoSendBill, markInvoiceShared, sendInvoiceWhatsApp } from "@/services/whatsapp.service";
import { toastBillSend } from "@/lib/bill-send-toast";
import { todayISO } from "@/lib/format";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  isWhatsAppApiLive,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { downloadInvoicePdf } from "@/lib/invoice-download";
import { cashOpenFrom, recordBalancePayment, undoBalancePayment } from "@/services/finance.service";
import { isOldBalanceBill } from "@/lib/old-money";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { useLive } from "@/hooks/use-live-query";
import { useAuth } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { EditBillDialog } from "@/components/billing/edit-bill-dialog";

export function InvoiceActions({
  invoice,
  compact = false,
}: {
  invoice: Invoice;
  compact?: boolean;
}) {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const { can } = useAccess();
  const [busy, setBusy] = useState(false);
  // Delete (owner, or a login given "Bills" delete): into the Recycle Bin.
  const bin = useBin();
  const [deleting, setDeleting] = useState(false);
  const url = getInvoicePublicUrl(invoice);
  const due = invoice.balanceDue > 0 && invoice.paymentStatus !== "refunded";

  const share = () => {
    window.open(
      manualWhatsAppUrl(invoice, wa.data.defaultCountryCode, business.data.businessName),
      "_blank",
      "noopener,noreferrer",
    );
    void markInvoiceShared(invoice).catch(() => undefined);
  };
  const sendApi = async () => {
    setBusy(true);
    try {
      const r = await sendInvoiceWhatsApp(invoice, wa.data, business.data);
      toast.success(r.duplicate ? "Already sent to this member" : "Bill sent on WhatsApp");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pdf = async () => {
    setBusy(true);
    try {
      await downloadInvoicePdf(invoice, business.data);
    } catch (e) {
      toast.error("Couldn't create the PDF", { description: firestoreErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex items-center gap-2", !compact && "w-full sm:w-auto")}>
      {due ? (
        <Button
          size="sm"
          onClick={() => setPaying(true)}
          className={cn(!compact && "flex-1 sm:flex-none")}
        >
          <IndianRupee aria-hidden /> Collect {formatPrice(invoice.balanceDue)}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={share}
        className={cn(!compact && "flex-1 sm:flex-none")}
        aria-label="Share bill on WhatsApp"
      >
        <MessageCircle aria-hidden className="text-[#128C7E] dark:text-[#25D366]" />{" "}
        {compact ? null : "WhatsApp"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`More for ${invoice.invoiceNumber}`}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <MoreHorizontal aria-hidden />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => window.open(url, "_blank", "noopener,noreferrer")}>
            <ExternalLink aria-hidden /> View bill
          </DropdownMenuItem>
          {can("billing") ? (
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit bill
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void pdf()}>
            <Download aria-hidden /> Download PDF
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void navigator.clipboard.writeText(url).then(() => toast.success("Bill link copied"))
            }
          >
            <Copy aria-hidden /> Copy link
          </DropdownMenuItem>
          {isWhatsAppApiLive(wa.data) ? (
            <DropdownMenuItem onSelect={() => void sendApi()}>
              <Send aria-hidden /> Send bill via WhatsApp API
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => window.open(url, "_blank", "noopener,noreferrer")}>
            <Printer aria-hidden /> Print
          </DropdownMenuItem>
          {bin.canDelete("bills") ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleting(true)}
              >
                <Trash2 aria-hidden /> Delete bill
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <BalancePaymentDialog invoice={invoice} open={paying} onOpenChange={setPaying} />
      {editing ? (
        <EditBillDialog
          invoice={invoice}
          settings={business.data}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete bill ${invoice.invoiceNumber}?`}
        description={`Its payments${invoice.amountPaid ? ` (${formatPrice(invoice.amountPaid)})` : ""} and the trainer's share from it go with it, so Collected and the Day Book drop by them. The plans on it stay: cancel them on the member's Plan tab if needed. It waits in the Recycle Bin, where it can be restored.`}
        confirmLabel="Delete bill"
        destructive
        onConfirm={() => {
          setDeleting(false);
          void bin.remove(`Bill ${invoice.invoiceNumber}`, (by) => binBill(invoice, by));
        }}
      />
    </div>
  );
}

function BalancePaymentDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const [amount, setAmount] = useState(invoice.balanceDue);
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [nextDate, setNextDate] = useState("");
  // The day it was paid: today, or an earlier day when it is typed in later.
  const [paidOn, setPaidOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setAmount(invoice.balanceDue);
      setNextDate("");
      setPaidOn(todayISO());
    }
  }
  const today = todayISO();
  const openFrom = cashOpenFrom(today);
  const dateProblem = !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)
    ? "Pick the day it was paid."
    : paidOn > today
      ? "It can't be after today."
      : paidOn < openFrom
        ? `Pick a day from ${formatDateISO(openFrom)} on (older days are closed in the Day Book).`
        : "";
  const restLeft = amount > 0 && amount < invoice.balanceDue;
  const save = async () => {
    setSaving(true);
    try {
      const { paymentId } = await recordBalancePayment(
        invoice,
        amount,
        method,
        user?.displayName || user?.email || "Staff",
        {
          staffUid: user?.uid ?? "",
          nextPaymentDate: restLeft ? nextDate : null,
          paymentDate: paidOn,
        },
      );
      toastWithUndo(
        "Payment recorded",
        () => undoBalancePayment(paymentId),
        `${formatPrice(amount)} for ${invoice.invoiceNumber}. Entered by mistake? Undo.`,
      );
      onOpenChange(false);
      // The updated bill (new paid / balance) goes to the member automatically.
      void autoSendBill(invoice.id).then(toastBillSend);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Collect balance · ${invoice.clientNameSnapshot}`}
      description={`${invoice.invoiceNumber} · Total ${formatPrice(invoice.total)} · Paid ${formatPrice(invoice.amountPaid)}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="lg"
            disabled={
              saving ||
              amount <= 0 ||
              amount > invoice.balanceDue ||
              (restLeft && !nextDate) ||
              !!dateProblem
            }
            onClick={() => save()}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Record{" "}
            {formatPrice(amount || 0)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="Amount received ₹"
          htmlFor="bal-amt"
          hint={`Balance due ${formatPrice(invoice.balanceDue)}`}
        >
          <Input
            id="bal-amt"
            type="number"
            inputMode="decimal"
            min={1}
            max={invoice.balanceDue}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </Field>
        {restLeft ? (
          <Field
            label="Next payment date"
            htmlFor="bal-next"
            required
            hint={`${formatPrice(invoice.balanceDue - amount)} will still be due. The member gets a WhatsApp reminder that morning.`}
          >
            <Input
              id="bal-next"
              type="date"
              min={todayISO()}
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          </Field>
        ) : null}
        <Field
          label="Paid on"
          htmlFor="bal-date"
          error={dateProblem || undefined}
          hint={
            dateProblem
              ? undefined
              : paidOn === today
                ? isOldBalanceBill(invoice)
                  ? `Paid back when the old software was used (before ${formatDateISO(openFrom)})? Add it on the member's plan instead: Edit plan → Paid in the old software. The balance here goes down by as much.`
                  : "Collected today. Paid on another day? Pick that day."
                : `Counted in Collected on ${formatDateISO(paidOn)}${method === "Cash" ? " and in that day's Day Book cash" : ""}, not today.`
          }
        >
          <Input
            id="bal-date"
            type="date"
            min={openFrom}
            max={today}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className="max-w-48"
          />
        </Field>
        <Field label="Paid by" htmlFor="bal-method">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" id="bal-method">
            {PAYMENT_METHODS.filter((m) => m !== "Other").map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-semibold",
                  method === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </FormDialog>
  );
}
