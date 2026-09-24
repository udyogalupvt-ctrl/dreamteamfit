import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Fingerprint,
  Loader2,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { DataImportWizard } from "@/components/settings/data-import-wizard";
import { DataExportPanel } from "@/components/settings/data-export-panel";
import { PageHeader } from "@/components/common/page-header";
import { FormSection } from "@/components/common/form-section";
import { Field } from "@/components/common/form-dialog";
import { ImageUpload } from "@/components/common/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { CLOUDINARY_BRAND_FOLDER } from "@/constants/navigation";
import { useLive } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";
import { DEFAULT_AUTOMATION_SETTINGS } from "@/lib/automation-templates";
import {
  DEFAULT_BILLING_SETTINGS,
  saveBusinessLogo,
  saveBusinessSettings,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import {
  saveAutomationSettings,
  subscribeAutomationSettings,
} from "@/services/automation-settings.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  saveWhatsAppSettings,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import { testWhatsAppConnection } from "@/services/whatsapp.service";
import type { AutomationSettings, BusinessBillingSettings, WhatsAppSettings } from "@/types/models";

const TABS = ["gym", "whatsapp", "reminders", "data", "appearance"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/settings")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  head: () => ({
    meta: [
      { title: "Settings — REBUILD FITNESS" },
      { name: "description", content: "Gym details on bills, WhatsApp, reminders and data." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { tab = "gym" } = Route.useSearch();
  const navigate = useNavigate({ from: "/settings" });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Gym details, WhatsApp, reminders and data."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Settings" }]}
      />
      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ search: { tab: v as Tab }, replace: true })}
        className="space-y-4"
      >
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="gym">Gym & bills</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
            <TabsTrigger value="reminders">Reminders</TabsTrigger>
            <TabsTrigger value="data">Import / export</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="gym">
          <GymSettings />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsAppSettingsPanel />
        </TabsContent>
        <TabsContent value="reminders">
          <ReminderSettings />
        </TabsContent>
        <TabsContent value="data" className="space-y-4">
          <DataImportWizard />
          <DataExportPanel />
        </TabsContent>
        <TabsContent value="appearance">
          <FormSection
            title="Theme"
            description="Light, dark, or follow the device. Saved on this device."
          >
            <ThemeToggle />
          </FormSection>
        </TabsContent>
      </Tabs>
      <Link
        to="/biometric-devices"
        className="surface-card flex items-center gap-3 p-4 transition-colors hover:bg-accent"
      >
        <Fingerprint className="size-5" aria-hidden />
        <span className="flex-1 text-sm">
          <b>Fingerprint device</b> setup lives in Fingerprint Devices.
        </span>
        <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </div>
  );
}

function GymSettings() {
  const live = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const [f, setF] = useState<BusinessBillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [saving, setSaving] = useState(false);
  // Fill the form once from the saved details; later only the logo follows the database, so a
  // logo save never wipes other fields typed but not saved yet.
  const filled = useRef(false);
  useEffect(() => {
    if (live.loading) return;
    if (!filled.current) {
      filled.current = true;
      setF(live.data);
    } else setF((x) => ({ ...x, logoUrl: live.data.logoUrl }));
  }, [live.data, live.loading]);
  const set = <K extends keyof BusinessBillingSettings>(k: K, v: BusinessBillingSettings[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const saveLogo = async (url: string) => {
    set("logoUrl", url);
    try {
      await saveBusinessLogo(url);
      toast.success(url ? "Logo saved" : "Logo removed");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveBusinessSettings(f);
      toast.success("Gym details saved", { description: "New bills will use them." });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormSection
      title="Gym details on bills"
      description="Printed on every bill and PDF, and used in WhatsApp messages."
      footer={
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save gym details
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Gym name" htmlFor="g-name">
          <Input
            id="g-name"
            value={f.businessName}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </Field>
        <Field label="Phone" htmlFor="g-phone">
          <Input
            id="g-phone"
            type="tel"
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
        <Field label="Address" htmlFor="g-addr" className="sm:col-span-2">
          <Textarea
            id="g-addr"
            rows={2}
            value={f.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="g-email">
          <Input
            id="g-email"
            type="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label="GSTIN (optional)" htmlFor="g-gst">
          <Input
            id="g-gst"
            value={f.gstin}
            onChange={(e) => set("gstin", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Bill number prefix" htmlFor="g-prefix" hint="e.g. INV → INV-2026-000123">
          <Input
            id="g-prefix"
            value={f.invoicePrefix}
            onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
          />
        </Field>
        <div className="grid gap-1.5">
          <span className="text-label">GST / tax on bills</span>
          <div className="flex items-center gap-3">
            <Switch
              checked={f.taxEnabled}
              onCheckedChange={(v) => set("taxEnabled", v)}
              aria-label="Charge tax on bills"
            />
            {f.taxEnabled ? (
              <Input
                aria-label="Tax rate percent"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                className="w-24"
                value={f.taxRate}
                onChange={(e) => set("taxRate", Number(e.target.value))}
              />
            ) : (
              <span className="text-meta">Off</span>
            )}
            {f.taxEnabled ? <span className="text-meta">%</span> : null}
          </div>
        </div>
        <ImageUpload
          className="sm:col-span-2"
          label="Logo on bills"
          folder={CLOUDINARY_BRAND_FOLDER}
          value={
            f.logoUrl ? { url: f.logoUrl, publicId: "", width: 0, height: 0, format: "" } : null
          }
          onChange={(img) => void saveLogo(img?.url ?? "")}
          hint="PNG works best on the PDF. Saved as soon as it uploads."
        />
      </div>
    </FormSection>
  );
}

function WhatsAppSettingsPanel() {
  const live = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const [f, setF] = useState<WhatsAppSettings>(DEFAULT_WHATSAPP_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => setF(live.data), [live.data]);
  const set = <K extends keyof WhatsAppSettings>(k: K, v: WhatsAppSettings[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const api = f.mode === "whatsapp";
  const save = async () => {
    // A phone number typed here would be glued in front of every member's number.
    if (!/^\d{1,3}$/.test(f.defaultCountryCode)) {
      toast.error("Country code must be 1 to 3 digits, for example 91 for India");
      return;
    }
    setSaving(true);
    try {
      await saveWhatsAppSettings({ ...f, enabled: api });
      toast.success("WhatsApp settings saved");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      const r = await testWhatsAppConnection();
      if (r.configured) toast.success(r.detail);
      else toast.warning(r.detail);
    } catch (e) {
      toast.error("Couldn't reach the WhatsApp server", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border p-4",
          api ? "border-success/40 bg-success/10" : "border-border bg-muted/40",
        )}
      >
        {api ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        ) : (
          <MessageCircle className="mt-0.5 size-5 shrink-0 text-[#25D366]" aria-hidden />
        )}
        <div className="text-sm">
          <p className="font-semibold">
            {api ? "Automatic sending is on" : "Manual sharing (works now)"}
          </p>
          <p className="text-muted-foreground">
            {api
              ? "After payment, the bill is sent from your WhatsApp Business number with a View bill button."
              : "After payment, staff tap “Share bill on WhatsApp”. WhatsApp opens on the member's chat with the bill link typed — just press Send. Turn on the API below to send automatically."}
          </p>
        </div>
      </div>
      <FormSection
        title="WhatsApp Cloud API"
        description="Uses your WhatsApp Business number and the approved message templates. Set up once; then press Test connection."
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={testing || !api} onClick={() => void test()}>
              {testing ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <MessageCircle aria-hidden />
              )}{" "}
              Test connection
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <ToggleRow
            label="Send through WhatsApp Cloud API"
            hint="Off = staff share manually from their phone."
            checked={api}
            onChange={(v) => set("mode", v ? "whatsapp" : "mock")}
          />
          {api ? (
            <>
              <ToggleRow
                label="Send the bill automatically after payment"
                hint="Only to members who agreed to WhatsApp messages."
                checked={f.autoSendInvoice}
                onChange={(v) => set("autoSendInvoice", v)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Bill template name"
                  htmlFor="wa-inv"
                  hint="Body {{1}} name, {{2}} gym, {{3}} bill no., {{4}} paid, {{5}} balance · URL button …/invoice/{{1}}"
                >
                  <Input
                    id="wa-inv"
                    value={f.invoiceTemplate}
                    onChange={(e) => set("invoiceTemplate", e.target.value.trim())}
                  />
                </Field>
                <Field label="Template language" htmlFor="wa-lang" hint="e.g. en, en_US">
                  <Input
                    id="wa-lang"
                    value={f.templateLanguage}
                    onChange={(e) => set("templateLanguage", e.target.value.trim())}
                  />
                </Field>
                <Field label="Renewal reminder template" htmlFor="wa-ren">
                  <Input
                    id="wa-ren"
                    value={f.renewalTemplate}
                    onChange={(e) => set("renewalTemplate", e.target.value.trim())}
                  />
                </Field>
                <Field label="Payment due template" htmlFor="wa-due">
                  <Input
                    id="wa-due"
                    value={f.paymentDueTemplate}
                    onChange={(e) => set("paymentDueTemplate", e.target.value.trim())}
                  />
                </Field>
                <Field label="Birthday template" htmlFor="wa-bday">
                  <Input
                    id="wa-bday"
                    value={f.birthdayTemplate}
                    onChange={(e) => set("birthdayTemplate", e.target.value.trim())}
                  />
                </Field>
                <Field label="Absence nudge template" htmlFor="wa-abs">
                  <Input
                    id="wa-abs"
                    value={f.absenceTemplate}
                    onChange={(e) => set("absenceTemplate", e.target.value.trim())}
                  />
                </Field>
                <Field
                  label="Announcement template"
                  htmlFor="wa-ann"
                  hint="Body {{1}} name, {{2}} gym, {{3}} your message"
                >
                  <Input
                    id="wa-ann"
                    value={f.announcementTemplate}
                    onChange={(e) => set("announcementTemplate", e.target.value.trim())}
                  />
                </Field>
              </div>
            </>
          ) : null}
          <Field
            label="Country code for 10-digit numbers"
            htmlFor="wa-cc"
            className="sm:max-w-xs"
            hint="Only the code, not a phone number. India is 91."
          >
            <Input
              id="wa-cc"
              inputMode="numeric"
              maxLength={3}
              value={f.defaultCountryCode}
              onChange={(e) =>
                set("defaultCountryCode", e.target.value.replace(/\D/g, "").slice(0, 3))
              }
            />
          </Field>
          <p className="text-meta flex items-center gap-1.5">
            <CircleAlert className="size-3.5" aria-hidden /> The access token is kept only on the
            server (Vercel environment variables), never here.
          </p>
        </div>
      </FormSection>
    </div>
  );
}

function ReminderSettings() {
  const live = useLive(subscribeAutomationSettings, DEFAULT_AUTOMATION_SETTINGS, []);
  const [f, setF] = useState<AutomationSettings>(DEFAULT_AUTOMATION_SETTINGS);
  useEffect(() => setF(live.data), [live.data]);
  const set = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      await saveAutomationSettings(f);
      toast.success("Reminder settings saved");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <FormSection
      title="Automatic reminders"
      description="Checked every morning (India time)."
      footer={<Button onClick={() => void save()}>Save reminders</Button>}
    >
      <div className="grid gap-4">
        <ToggleRow
          label="Renewal reminders"
          hint="Message members before their plan ends."
          checked={f.automationEnabled && f.renewalEnabled}
          onChange={(v) =>
            setF((x) => ({ ...x, automationEnabled: v || x.birthdayEnabled, renewalEnabled: v }))
          }
        />
        {f.renewalEnabled ? (
          <>
            <Field label="Days before the plan ends" htmlFor="r-days" className="sm:max-w-xs">
              <Input
                id="r-days"
                type="number"
                min="1"
                max="30"
                value={f.renewalDaysBefore}
                onChange={(e) => set("renewalDaysBefore", Number(e.target.value))}
              />
            </Field>
            <Field
              label="Renewal message"
              htmlFor="r-tpl"
              hint="{{name}} and {{expiryDate}} are filled in automatically."
            >
              <Textarea
                id="r-tpl"
                className="min-h-32"
                value={f.renewalTemplate}
                onChange={(e) => set("renewalTemplate", e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <ToggleRow
          label="Balance due reminders"
          hint="WhatsApp with the balance and bill link, once a day (about 8 AM) from a few days before the next payment date until that day."
          checked={f.automationEnabled && f.paymentDueEnabled}
          onChange={(v) =>
            setF((x) => ({
              ...x,
              automationEnabled: v || x.automationEnabled,
              paymentDueEnabled: v,
            }))
          }
        />
        {f.paymentDueEnabled ? (
          <Field
            label="Start reminders this many days before"
            htmlFor="pd-days"
            className="sm:max-w-xs"
            hint="3 = messages 3, 2 and 1 day before, and on the day. 0 = only on the day."
          >
            <Input
              id="pd-days"
              type="number"
              min="0"
              max="7"
              value={f.paymentDueDaysBefore}
              onChange={(e) =>
                set("paymentDueDaysBefore", Math.min(7, Math.max(0, Number(e.target.value) || 0)))
              }
            />
          </Field>
        ) : null}
        <ToggleRow
          label="Birthday wishes"
          hint="Message members on their birthday."
          checked={f.automationEnabled && f.birthdayEnabled}
          onChange={(v) =>
            setF((x) => ({ ...x, automationEnabled: v || x.renewalEnabled, birthdayEnabled: v }))
          }
        />
        {f.birthdayEnabled ? (
          <Field
            label="Birthday message"
            htmlFor="b-tpl"
            hint="{{name}} is filled in automatically."
          >
            <Textarea
              id="b-tpl"
              className="min-h-28"
              value={f.birthdayTemplate}
              onChange={(e) => set("birthdayTemplate", e.target.value)}
            />
          </Field>
        ) : null}
        <ToggleRow
          label="Missed-workout nudge"
          hint="Motivating WhatsApp message with a quote when a member stops coming. Each message costs WhatsApp charges, so it is off by default."
          checked={f.automationEnabled && f.absenceEnabled}
          onChange={(v) =>
            setF((x) => ({ ...x, automationEnabled: v || x.automationEnabled, absenceEnabled: v }))
          }
        />
        {f.absenceEnabled ? (
          <Field
            label="Send after this many days without a thumb punch"
            htmlFor="abs-days"
            className="sm:max-w-xs"
            hint="Checked every night at 9:30 PM after closing. One message per absence; sent again only after they come back and miss again."
          >
            <Input
              id="abs-days"
              type="number"
              min="2"
              max="30"
              value={f.absenceDays}
              onChange={(e) => set("absenceDays", Math.max(2, Number(e.target.value) || 3))}
            />
          </Field>
        ) : null}
      </div>
    </FormSection>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-meta">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
