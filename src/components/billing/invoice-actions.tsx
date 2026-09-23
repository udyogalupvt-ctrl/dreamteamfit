import { useState } from "react";
import { Copy, Download, ExternalLink, IndianRupee, MessageCircle, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { formatPrice } from "@/lib/format";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { PAYMENT_METHODS, type Invoice, type PaymentMethod } from "@/types/models";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { DEFAULT_WHATSAPP_SETTINGS, subscribeWhatsAppSettings } from "@/services/whatsapp-settings.service";
import { recordBalancePayment } from "@/services/finance.service";
import { useLive } from "@/hooks/use-live-query";
import { useAuth } from "@/hooks/use-auth";

export function invoiceShareMessage(invoice: Pick<Invoice, "clientNameSnapshot" | "invoiceNumber" | "total" | "publicToken">) {
  return `Hi ${invoice.clientNameSnapshot}, thank you for choosing REBUILD FITNESS. Your invoice ${invoice.invoiceNumber} for ${formatPrice(invoice.total)} is ready: ${getInvoicePublicUrl(invoice)}`;
}

export function manualWhatsAppUrl(invoice: Invoice, countryCode = "91") {
  const n = normalizeWhatsAppPhone(invoice.clientPhoneSnapshot, countryCode);
  const text = encodeURIComponent(invoiceShareMessage(invoice));
  return n.ok ? `https://wa.me/${n.value}?text=${text}` : `https://wa.me/?text=${text}`;
}

export function InvoiceActions({ invoice, compact = false }: { invoice: Invoice; compact?: boolean }) {
  const settings = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const [paying, setPaying] = useState(false);
  const url = getInvoicePublicUrl(invoice);
  const copy = async () => { await navigator.clipboard.writeText(url); toast.success("Invoice link copied"); };
  const open = () => window.open(url, "_blank", "noopener,noreferrer");
  const openWa = () => window.open(manualWhatsAppUrl(invoice, settings.data.defaultCountryCode), "_blank", "noopener,noreferrer");
  const send = async () => {
    try {
      const result = await sendWhatsAppMessage({
        client: { id: invoice.clientId, fullName: invoice.clientNameSnapshot, phone: invoice.clientPhoneSnapshot, whatsappPhone: invoice.clientPhoneSnapshot, whatsappOptIn: true },
        type: "invoice", referenceId: invoice.id, templateName: settings.data.invoiceTemplate, templateLanguage: settings.data.templateLanguage,
        parameters: [invoice.clientNameSnapshot, invoice.invoiceNumber, url], messagePreview: invoiceShareMessage(invoice), provider: settings.data.mode,
      });
      toast.success(result.duplicate ? "Invoice message already queued" : settings.data.mode === "mock" ? "Invoice queued in Mock mode" : "Invoice sent to WhatsApp");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't send invoice"); }
  };
  const size = compact ? "icon-sm" : "sm";
  return (
    <div className="flex flex-wrap gap-2">
      {invoice.balanceDue > 0 && invoice.paymentStatus !== "refunded" ? (
        <Button size="sm" onClick={() => setPaying(true)} aria-label={`Record remaining ${formatPrice(invoice.balanceDue)}`}>
          <IndianRupee /> {compact ? "Collect" : `Collect balance ${formatPrice(invoice.balanceDue)}`}
        </Button>
      ) : null}
      <Button size={size} variant="outline" aria-label="View public invoice" onClick={open}><ExternalLink />{compact ? null : "View"}</Button>
      <Button size={size} variant="outline" aria-label="Download PDF" disabled={!invoice.pdfUrl} asChild={Boolean(invoice.pdfUrl)}>
        {invoice.pdfUrl ? <a href={invoice.pdfUrl} target="_blank" rel="noreferrer"><Download />{compact ? null : "PDF"}</a> : <><Download />{compact ? null : "PDF"}</>}
      </Button>
      <Button size={size} variant="outline" aria-label="Copy public link" onClick={() => void copy()}><Copy />{compact ? null : "Copy link"}</Button>
      <Button size={size} variant="outline" aria-label="Send invoice via WhatsApp" onClick={() => void send()}><Send />{compact ? null : "Send WhatsApp"}</Button>
      <Button size={size} variant="outline" aria-label="Open WhatsApp to share" onClick={openWa}><MessageCircle />{compact ? null : "Open WhatsApp"}</Button>
      <Button size={size} variant="outline" aria-label="Print invoice" onClick={open}><Printer />{compact ? null : "Print"}</Button>
      <BalancePaymentDialog invoice={invoice} open={paying} onOpenChange={setPaying} />
    </div>
  );
}

function BalancePaymentDialog({ invoice, open, onOpenChange }: { invoice: Invoice; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const [amount, setAmount] = useState(invoice.balanceDue);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await recordBalancePayment(invoice, amount, method, user?.displayName || user?.email || "Staff");
      toast.success("Payment recorded", { description: `${formatPrice(amount)} for ${invoice.invoiceNumber}` });
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={`Collect balance · ${invoice.invoiceNumber}`}
      description={`Total ${formatPrice(invoice.total)} · Already paid ${formatPrice(invoice.amountPaid)} · Remaining ${formatPrice(invoice.balanceDue)}`}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving || amount <= 0 || amount > invoice.balanceDue} onClick={() => void save()}>Record {formatPrice(amount || 0)}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (remaining balance)" htmlFor="bal-amt" hint={`Up to ${formatPrice(invoice.balanceDue)}`}>
          <Input id="bal-amt" type="number" min={1} max={invoice.balanceDue} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Field label="Payment method" htmlFor="bal-method">
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}><SelectTrigger id="bal-method"><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
        </Field>
      </div>
    </FormDialog>
  );
}
