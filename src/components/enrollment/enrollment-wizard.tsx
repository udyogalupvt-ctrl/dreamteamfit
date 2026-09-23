import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Fingerprint, Loader2, MessageCircle, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/form-dialog";
import { ImageUpload } from "@/components/common/image-upload";
import { StatusPill } from "@/components/common/status-pill";
import { CLOUDINARY_CLIENT_FOLDER } from "@/constants/navigation";
import { useLive } from "@/hooks/use-live-query";
import { useAuth } from "@/hooks/use-auth";
import { SOURCE_LABELS, formatPrice, formatDateISO, normalizePhone, todayISO } from "@/lib/format";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { cn } from "@/lib/utils";
import { subscribePackages } from "@/services/packages.service";
import { calculateShare, PT_DURATION_LABELS, subscribePtPackages, subscribeTrainers } from "@/services/pt.service";
import { DEFAULT_BILLING_SETTINGS, subscribeBusinessSettings } from "@/services/business-settings.service";
import { subscribeDevices } from "@/services/biometric-devices.service";
import { enrollMember, enrollmentTotals, registerFirstThumb, subscribeEnrollment, suggestBiometricUserId } from "@/services/enrollment.service";
import { findClientsByPhone, type ClientInput } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeInvoices } from "@/services/invoices.service";
import { invoiceShareMessage, manualWhatsAppUrl } from "@/components/billing/invoice-actions";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { DEFAULT_WHATSAPP_SETTINGS, subscribeWhatsAppSettings } from "@/services/whatsapp-settings.service";
import { GENDERS, LEAD_SOURCES, PAYMENT_METHODS, type Invoice, type PaymentMethod, type ShareType } from "@/types/models";
import type { EnrollmentOpenOptions } from "./enrollment-context";

const STEPS = ["Client", "Package", "PT", "Payment", "Invoice", "Biometric", "Complete"] as const;
const EMPTY: ClientInput = { fullName: "", phone: "", email: "", profilePhotoUrl: null, dateOfBirth: null, gender: "unspecified", address: "", emergencyContact: "", source: "walk_in", notes: "", status: "active" };

export function EnrollmentWizard({ options, onClose }: { options: EnrollmentOpenOptions; onClose: () => void }) {
  const { user } = useAuth();
  const existing = options.existingClient ?? null;
  const [step, setStep] = useState(options.resumeEnrollmentId ? 5 : existing ? 1 : 0);
  const [client, setClient] = useState<ClientInput>({ ...EMPTY, ...options.prefill });
  const [packageId, setPackageId] = useState("");
  const [ptOn, setPtOn] = useState(false);
  const [ptPackageId, setPtPackageId] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [shareOverride, setShareOverride] = useState<{ type: ShareType; value: number } | null>(null);
  const [startDate, setStartDate] = useState(todayISO());
  const [discount, setDiscount] = useState(0);
  const [amountPaid, setAmountPaid] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(options.resumeEnrollmentId ?? null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  const packages = useLive(subscribePackages, [], []);
  const ptPackages = useLive(subscribePtPackages, [], []);
  const trainers = useLive(subscribeTrainers, [], []);
  const settings = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const enrollment = useLive(enrollmentId ? (ok, fail) => subscribeEnrollment(enrollmentId, ok, fail) : null, null as Enrollment | null, [enrollmentId]);
  const invoices = useLive(subscribeInvoices, [], []);
  const invoice: Invoice | null = invoices.data.find((i) => i.id === (invoiceId ?? enrollment.data?.invoiceId)) ?? null;

  const gymPackage = packages.data.find((p) => p.id === packageId) ?? null;
  const ptPkg = ptOn ? ptPackages.data.find((p) => p.id === ptPackageId) ?? null : null;
  const trainer = ptOn ? trainers.data.find((t) => t.id === trainerId) ?? null : null;
  const shareType = shareOverride?.type ?? trainer?.defaultShareType ?? "percentage";
  const shareValue = shareOverride?.value ?? trainer?.defaultTrainerShare ?? 0;
  const pt = ptPkg && trainer ? { pkg: ptPkg, trainer, shareType, shareValue } : null;
  const totals = useMemo(() => enrollmentTotals({ gymPackage, pt, discount, amountPaid: amountPaid ?? Number.MAX_SAFE_INTEGER, settings: settings.data }), [gymPackage, pt, discount, amountPaid, settings.data]);
  const paid = amountPaid ?? totals.total;

  useEffect(() => { setShareOverride(null); }, [trainerId]);

  const validate = async (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (client.fullName.trim().length < 2) e["fullName"] = "Full name is required";
      if (normalizePhone(client.phone).length < 7) e["phone"] = "Valid phone is required";
      if (client.email && !/^\S+@\S+\.\S+$/.test(client.email)) e["email"] = "Invalid email";
      if (!e["phone"]) { const dup = await findClientsByPhone(client.phone); if (dup.length) e["phone"] = `Already a client: ${dup[0]!.fullName} (${dup[0]!.clientCode})`; }
    }
    if (s === 1 && !gymPackage && !ptOn) e["package"] = "Select a gym package";
    if (s === 2 && ptOn) { if (!ptPkg) e["ptPackage"] = "PT package is required"; if (!trainer) e["trainer"] = "Trainer is required"; }
    if (s === 3) { if (!gymPackage && !pt) e["package"] = "Select a package"; if (paid < 0 || paid > totals.total) e["amountPaid"] = "Paid must be between 0 and total"; }
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const next = async () => { if (await validate(step)) setStep((s) => Math.min(s + 1, 3)); };

  const confirm = async () => {
    if (!(await validate(3))) return;
    setSaving(true);
    try {
      const r = await enrollMember({ client, existingClient: existing, inquiryId: options.inquiryId ?? null, gymPackage, pt, startDate, discount, amountPaid: paid, method, notes, settings: settings.data, staff: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Staff" } });
      setEnrollmentId(r.enrollmentId); setInvoiceId(r.invoice.id);
      toast.success("Payment recorded and invoice generated", { description: r.invoice.invoiceNumber });
      setStep(4);
    } catch (err) { toast.error(firestoreErrorMessage(err)); } finally { setSaving(false); }
  };

  const locked = step >= 4;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn("flex max-h-[94dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-3xl", "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none")}>
        <DialogHeader className="border-b border-border px-5 pt-5 pb-3 text-left sm:px-6">
          <DialogTitle className="text-section-title">{existing ? `New membership · ${existing.fullName}` : options.inquiryId ? "Convert lead to member" : "New member"}</DialogTitle>
          <DialogDescription>One flow: details, package, PT, payment, invoice and fingerprint.</DialogDescription>
          <ol className="no-scrollbar mt-3 flex gap-1 overflow-x-auto" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
                <span className="tabular-nums">{i < step ? <Check className="size-3" /> : i + 1}</span>{s}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {step === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageUpload className="sm:col-span-2" label="Profile photo" folder={CLOUDINARY_CLIENT_FOLDER} value={client.profilePhotoUrl ? { url: client.profilePhotoUrl, publicId: "", width: 0, height: 0, format: "", bytes: 0 } as never : null} onChange={(img) => setClient({ ...client, profilePhotoUrl: img?.url ?? null })} />
              <Field label="Full name" htmlFor="e-name" required error={errors["fullName"]}><Input id="e-name" value={client.fullName} onChange={(e) => setClient({ ...client, fullName: e.target.value })} /></Field>
              <Field label="Phone" htmlFor="e-phone" required error={errors["phone"]}><Input id="e-phone" type="tel" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></Field>
              <Field label="Email" htmlFor="e-email" error={errors["email"]}><Input id="e-email" type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} /></Field>
              <Field label="Date of birth" htmlFor="e-dob"><Input id="e-dob" type="date" value={client.dateOfBirth ?? ""} onChange={(e) => setClient({ ...client, dateOfBirth: e.target.value || null })} /></Field>
              <Field label="Gender" htmlFor="e-gender"><Select value={client.gender} onValueChange={(v) => setClient({ ...client, gender: v as ClientInput["gender"] })}><SelectTrigger id="e-gender" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{GENDERS.map((g) => <SelectItem key={g} value={g} className="capitalize">{g}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Source" htmlFor="e-source"><Select value={client.source} onValueChange={(v) => setClient({ ...client, source: v as ClientInput["source"] })}><SelectTrigger id="e-source" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Emergency contact" htmlFor="e-emg"><Input id="e-emg" value={client.emergencyContact} onChange={(e) => setClient({ ...client, emergencyContact: e.target.value })} /></Field>
              <Field label="Address" htmlFor="e-addr"><Input id="e-addr" value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} /></Field>
              <Field label="Notes" htmlFor="e-notes" className="sm:col-span-2"><Textarea id="e-notes" value={client.notes} onChange={(e) => setClient({ ...client, notes: e.target.value })} /></Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              {errors["package"] ? <p role="alert" className="text-sm font-medium text-destructive">{errors["package"]}</p> : null}
              {packages.data.filter((p) => p.isActive).length === 0 ? <p className="text-sm text-muted-foreground">No active gym packages. <Link to="/packages" className="underline" onClick={onClose}>Create one in Packages</Link>.</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {packages.data.filter((p) => p.isActive).map((p) => (
                  <button type="button" key={p.id} onClick={() => setPackageId(packageId === p.id ? "" : p.id)} aria-pressed={packageId === p.id}
                    className={cn("rounded-xl border p-4 text-left transition-colors", packageId === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}>
                    <p className="text-xs font-semibold text-muted-foreground">{p.category}</p>
                    <p className="font-bold">{p.name}</p>
                    <p className="text-meta">{p.durationDays} days</p>
                    <p className="mt-2 text-lg font-extrabold tabular-nums">{formatPrice(p.price)}</p>
                  </button>
                ))}
              </div>
              <Field label="Start date" htmlFor="e-start"><Input id="e-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="sm:max-w-xs" /></Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
                <span><span className="block font-semibold">Add Personal Training</span><span className="text-meta">Off by default. When on, PT package and trainer are required.</span></span>
                <Switch checked={ptOn} onCheckedChange={setPtOn} aria-label="Add personal training" />
              </label>
              {ptOn ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="PT package" htmlFor="e-ptpkg" required error={errors["ptPackage"]}>
                    <Select value={ptPackageId} onValueChange={setPtPackageId}><SelectTrigger id="e-ptpkg" className="w-full"><SelectValue placeholder="Select PT package" /></SelectTrigger>
                      <SelectContent>{ptPackages.data.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {PT_DURATION_LABELS[p.durationType]} · {formatPrice(p.price)}</SelectItem>)}</SelectContent></Select>
                  </Field>
                  <Field label="Trainer" htmlFor="e-trainer" required error={errors["trainer"]}>
                    <Select value={trainerId} onValueChange={setTrainerId}><SelectTrigger id="e-trainer" className="w-full"><SelectValue placeholder="Select trainer" /></SelectTrigger>
                      <SelectContent>{trainers.data.filter((t) => t.status === "active").map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.specialization ? ` · ${t.specialization}` : ""}</SelectItem>)}</SelectContent></Select>
                  </Field>
                  {(!ptPackages.data.length || !trainers.data.length) ? <p className="text-meta sm:col-span-2">Add PT packages and trainers in <Link to="/packages" className="underline" onClick={onClose}>Packages</Link>.</p> : null}
                  {trainer ? (
                    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                      <Field label="Trainer share type (this assignment)" htmlFor="e-sharetype">
                        <Select value={shareType} onValueChange={(v) => setShareOverride({ type: v as ShareType, value: shareValue })}><SelectTrigger id="e-sharetype" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="percentage">Percentage</SelectItem><SelectItem value="fixed">Fixed amount</SelectItem></SelectContent></Select>
                      </Field>
                      <Field label={shareType === "percentage" ? "Trainer share %" : "Trainer share ₹"} htmlFor="e-shareval" hint="Defaults from trainer profile; admin may override.">
                        <Input id="e-shareval" type="number" min={0} value={shareValue} onChange={(e) => setShareOverride({ type: shareType, value: Number(e.target.value) })} />
                      </Field>
                    </div>
                  ) : null}
                  {ptPkg && trainer ? (() => { const s = calculateShare(ptPkg.price, shareType, shareValue); return (
                    <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-4 sm:col-span-2">
                      <div><dt className="text-meta">PT price</dt><dd className="font-bold tabular-nums">{formatPrice(s.ptPrice)}</dd></div>
                      <div><dt className="text-meta">Trainer share</dt><dd className="font-bold tabular-nums">{formatPrice(s.trainerShareAmount)}</dd></div>
                      <div><dt className="text-meta">Gym share</dt><dd className="font-bold tabular-nums">{formatPrice(s.gymShareAmount)}</dd></div>
                    </dl>); })() : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <div className="space-y-4">
                <Summary title="Customer" rows={[[existing?.fullName ?? client.fullName, existing?.phone ?? client.phone]]} />
                {gymPackage ? <Summary title="Gym membership" rows={[[`${gymPackage.name} · ${gymPackage.category}`, formatPrice(gymPackage.price)], ["Starts", formatDateISO(startDate)]]} /> : null}
                {pt && totals.share ? <Summary title="Personal training" rows={[[pt.pkg.name, formatPrice(pt.pkg.price)], ["Trainer", pt.trainer.name], ["Trainer share", formatPrice(totals.share.trainerShareAmount)], ["Gym share", formatPrice(totals.share.gymShareAmount)]]} /> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Discount ₹" htmlFor="e-disc"><Input id="e-disc" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></Field>
                  <Field label="Amount paid now ₹" htmlFor="e-paid" error={errors["amountPaid"]} hint="Defaults to full total. Lower it for partial payment."><Input id="e-paid" type="number" min={0} max={totals.total} value={paid} onChange={(e) => setAmountPaid(Number(e.target.value))} /></Field>
                  <Field label="Payment method" htmlFor="e-method"><Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}><SelectTrigger id="e-method" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Invoice note" htmlFor="e-inote"><Input id="e-inote" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                </div>
              </div>
              <aside className="h-fit rounded-2xl bg-foreground p-5 text-background">
                <p className="text-xs font-bold tracking-wider text-background/60 uppercase">Payment</p>
                <dl className="mt-4 space-y-2 text-sm">
                  {([["Subtotal", totals.subtotal], ["Discount", -totals.discount], ["Tax", totals.tax], ["Total", totals.total], ["Paid", Math.min(paid, totals.total)], ["Balance", Math.max(0, totals.total - paid)]] as const).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><dt>{k}</dt><dd className="font-bold tabular-nums">{formatPrice(v)}</dd></div>))}
                  <div className="flex justify-between border-t border-background/20 pt-2"><dt>Method</dt><dd className="font-bold">{method}</dd></div>
                </dl>
              </aside>
            </div>
          ) : null}

          {step === 4 ? <InvoiceStep invoice={invoice} /> : null}

          {step === 5 && enrollmentId ? <BiometricStep enrollmentId={enrollmentId} status={enrollment.data?.status} lastError={enrollment.data?.lastError ?? ""} onDone={() => setStep(6)} /> : null}

          {step === 6 ? (
            enrollment.data?.status === "active" ? (
              <div className="grid place-items-center gap-3 py-10 text-center"><CheckCircle2 className="size-12 text-success" /><p className="text-section-title">Enrollment complete</p><p className="text-meta">Membership active, fingerprint confirmed by the device, access allowed.</p></div>
            ) : (
              <div className="grid place-items-center gap-3 py-10 text-center"><ShieldAlert className="size-12 text-warning" /><p className="text-section-title">Pending biometric</p><p className="text-meta max-w-md">Payment and invoice are saved. Membership stays <b>biometric pending</b> and access is <b>blocked</b> until the first thumb is registered on a real device. Use “Complete Biometric Registration” on the client profile.</p></div>
            )
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 sm:px-6">
          {!locked && step > (existing ? 1 : 0) ? <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft /> Back</Button> : <span />}
          <div className="flex gap-2">
            {step < 3 ? <Button onClick={() => void next()}>Next <ChevronRight /></Button> : null}
            {step === 3 ? <Button disabled={saving} onClick={() => void confirm()}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Confirm enrollment · {formatPrice(Math.min(paid, totals.total))}</Button> : null}
            {step === 4 ? <Button onClick={() => setStep(enrollment.data?.status === "active" ? 6 : 5)}>Continue <ChevronRight /></Button> : null}
            {step === 5 ? <Button variant="outline" onClick={() => setStep(6)}>Finish later</Button> : null}
            {step === 6 ? <Button onClick={onClose}>Close</Button> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ title, rows }: { title: string; rows: (readonly [string, string])[] | [string, string][] }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <p className="text-eyebrow mb-2">{title}</p>
      {rows.map(([a, b]) => <div key={a + b} className="flex justify-between gap-3 text-sm"><span>{a}</span><span className="font-semibold tabular-nums">{b}</span></div>)}
    </section>
  );
}

function InvoiceStep({ invoice }: { invoice: Invoice | null }) {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  if (!invoice) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" /></div>;
  const send = async () => {
    try {
      const r = await sendWhatsAppMessage({ client: { id: invoice.clientId, fullName: invoice.clientNameSnapshot, phone: invoice.clientPhoneSnapshot, whatsappPhone: invoice.clientPhoneSnapshot, whatsappOptIn: true }, type: "invoice", referenceId: invoice.id, templateName: wa.data.invoiceTemplate, templateLanguage: wa.data.templateLanguage, parameters: [invoice.clientNameSnapshot, invoice.invoiceNumber, getInvoicePublicUrl(invoice)], messagePreview: invoiceShareMessage(invoice), provider: wa.data.mode });
      toast.success(r.duplicate ? "Already queued" : wa.data.mode === "mock" ? "Queued in Mock mode" : "Sent on WhatsApp");
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-lg font-extrabold">{invoice.invoiceNumber}</p><StatusPill tone={invoice.balanceDue ? "warning" : "success"}>{invoice.balanceDue ? "Partial" : "Paid"}</StatusPill></div>
        {invoice.items.map((i) => <div key={i.name} className="mt-2 flex justify-between text-sm"><span>{i.name}</span><span className="tabular-nums">{formatPrice(i.total)}</span></div>)}
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm"><div><p className="text-meta">Total</p><b>{formatPrice(invoice.total)}</b></div><div><p className="text-meta">Paid</p><b>{formatPrice(invoice.amountPaid)}</b></div><div><p className="text-meta">Balance</p><b>{formatPrice(invoice.balanceDue)}</b></div></div>
        <p className="text-meta mt-2">{invoice.paymentMethod} · PDF {invoice.pdfUrl ? "ready" : "generating / retry from Billing"}</p>
      </div>
      <p className="text-meta">Sending to {invoice.clientPhoneSnapshot} (from the client details).</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void send()}><Send /> Send invoice on WhatsApp</Button>
        <Button variant="outline" onClick={() => window.open(manualWhatsAppUrl(invoice, wa.data.defaultCountryCode), "_blank", "noopener,noreferrer")}><MessageCircle /> Open WhatsApp</Button>
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(getInvoicePublicUrl(invoice)).then(() => toast.success("Link copied"))}><Copy /> Copy invoice link</Button>
      </div>
    </div>
  );
}

export function BiometricStep({ enrollmentId, status, lastError, onDone }: { enrollmentId: string; status?: string | undefined; lastError: string; onDone: () => void }) {
  const devices = useLive(subscribeDevices, [], []);
  const usable = devices.data.filter((d) => d.status !== "disabled");
  const [deviceId, setDeviceId] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void suggestBiometricUserId().then((v) => setUserId((u) => u || v)); }, []);
  useEffect(() => { if (!deviceId && usable[0]) setDeviceId(usable[0].id); }, [usable, deviceId]);
  useEffect(() => { if (status === "active") onDone(); }, [status, onDone]);
  const device = usable.find((d) => d.id === deviceId);
  const register = async () => {
    if (!device || !userId.trim()) return;
    setBusy(true); setMessage("Waiting for device confirmation…");
    try {
      const r = await registerFirstThumb(enrollmentId, device, userId.trim());
      setMessage(r.ok ? "Thumb registered — confirmed by device." : r.message);
      if (r.ok) toast.success("First thumb registered. Membership activated."); else toast.error("Biometric registration not completed");
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Fingerprint className="size-5" /><p className="text-card-title">Biometric registration</p><StatusPill tone={status === "active" ? "success" : "warning"}>{status === "active" ? "Active" : "Pending registration"}</StatusPill></div>
      {!usable.length ? (
        <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"><AlertTriangle className="size-5 shrink-0 text-warning" /><div><p className="font-semibold">Biometric hardware integration is not configured.</p><p>Membership activation is pending biometric registration. Add a device in <Link to="/biometric-devices" className="underline">Biometric devices</Link>.</p></div></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Device" htmlFor="b-dev"><Select value={deviceId} onValueChange={setDeviceId}><SelectTrigger id="b-dev" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{usable.map((d) => <SelectItem key={d.id} value={d.id}>{d.name} · {d.manufacturer}{d.integrationType === "mock" ? " (development mock)" : ""}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Biometric user ID" htmlFor="b-uid"><Input id="b-uid" value={userId} onChange={(e) => setUserId(e.target.value)} /></Field>
        </div>
      )}
      {(message || lastError) ? <p role="status" className={cn("rounded-lg p-3 text-sm", message.startsWith("Thumb registered") ? "bg-success/10 text-success" : "bg-muted")}>{message || lastError}</p> : null}
      <Button disabled={!device || busy || !userId.trim()} onClick={() => void register()}>{busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Register First Thumb</Button>
      <p className="text-meta">The member becomes active only when the device confirms the fingerprint. Until then access stays blocked.</p>
    </div>
  );
}
