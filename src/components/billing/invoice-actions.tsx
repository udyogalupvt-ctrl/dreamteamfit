import { useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  IndianRupee,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Printer,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { manualWhatsAppUrl } from "@/lib/invoice-share";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, type Invoice, type PaymentMethod } from "@/types/models";
import { markInvoiceShared, sendInvoiceWhatsApp } from "@/services/whatsapp.service";
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
import { recordBalancePayment } from "@/services/finance.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { useLive } from "@/hooks/use-live-query";
import { useAuth } from "@/hooks/use-auth";

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
  const [busy, setBusy] = useState(false);
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
      toast.success(r.duplicate ? "Already sent to this member" : "Bill PDF sent on WhatsApp");
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
        <MessageCircle aria-hidden className="text-[#25D366]" /> {compact ? null : "WhatsApp"}
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
              <Send aria-hidden /> Send PDF via WhatsApp API
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => window.open(url, "_blank", "noopener,noreferrer")}>
            <Printer aria-hidden /> Print
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BalancePaymentDialog invoice={invoice} open={paying} onOpenChange={setPaying} />
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
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setAmount(invoice.balanceDue);
  }
  const save = async () => {
    setSaving(true);
    try {
      await recordBalancePayment(
        invoice,
        amount,
        method,
        user?.displayName || user?.email || "Staff",
      );
      toast.success("Payment recorded", {
        description: `${formatPrice(amount)} for ${invoice.invoiceNumber}`,
      });
      onOpenChange(false);
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
            disabled={saving || amount <= 0 || amount > invoice.balanceDue}
            onClick={() => void save()}
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
