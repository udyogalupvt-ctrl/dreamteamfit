import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { CFO_LANGUAGES, type CfoLanguage, type CfoSettings } from "@/lib/cfo/types";
import {
  cfoSettingsToForm,
  validateCfoSettings,
  type CfoSettingsErrors,
  type CfoSettingsForm,
} from "@/lib/cfo-settings-validation";
import { todayISO } from "@/lib/format";
import { saveCfoSettings } from "@/services/cfo.service";
import { firestoreErrorMessage } from "@/services/firestore.service";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-eyebrow mb-1">{title}</legend>
      {children}
    </fieldset>
  );
}

export function CfoSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CfoSettings;
  /** Called after the settings are saved (the page then asks to work the numbers out again). */
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<CfoSettingsForm>(() => cfoSettingsToForm(settings));
  const [errors, setErrors] = useState<CfoSettingsErrors>({});
  const [saving, setSaving] = useState(false);
  const today = todayISO();

  // Each time the dialog opens it starts from what is saved.
  useEffect(() => {
    if (open) {
      setForm(cfoSettingsToForm(settings));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof CfoSettingsForm>(key: K, value: CfoSettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    const result = validateCfoSettings(form, today);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await saveCfoSettings(result.value, user?.displayName || user?.email || "Staff");
      toast.success("CFO settings saved");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const number = (
    key: keyof CfoSettingsForm,
    label: string,
    hint: string,
    extra: { step?: string } = {},
  ) => (
    <Field label={label} htmlFor={`cfo-${key}`} error={errors[key]} hint={hint}>
      <Input
        id={`cfo-${key}`}
        type="number"
        inputMode="decimal"
        min={0}
        step={extra.step ?? "1"}
        value={String(form[key])}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="CFO settings"
      description="Your starting money, when to raise an alert, and the AI summary."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save settings
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Group title="Opening money">
          <p className="text-sm text-muted-foreground">
            Total gym money at the START of the date you choose: bank + UPI + card + cash drawer,
            before any payment or expense that day. Tip: last night&apos;s bank balance plus this
            morning&apos;s drawer.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Money in the gym (₹)"
              htmlFor="cfo-openingBalance"
              error={errors.openingBalance}
            >
              <Input
                id="cfo-openingBalance"
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                placeholder="e.g. 250000"
                value={form.openingBalance}
                aria-invalid={errors.openingBalance ? true : undefined}
                onChange={(e) => set("openingBalance", e.target.value)}
              />
            </Field>
            <Field
              label="On the start of this date"
              htmlFor="cfo-openingDate"
              error={errors.openingDate}
            >
              <Input
                id="cfo-openingDate"
                type="date"
                max={today}
                value={form.openingDate}
                aria-invalid={errors.openingDate ? true : undefined}
                onChange={(e) => set("openingDate", e.target.value)}
              />
            </Field>
          </div>
        </Group>

        <Group title="When to raise an alert">
          <div className="grid gap-3 sm:grid-cols-2">
            {number("atRiskDays", "Not seen for (days)", "Members who haven't come for this long")}
            {number("renewalDays", "Plan ends within (days)", "Shows the renewals coming")}
            {number(
              "newMemberMinVisits",
              "New member visits",
              "A new member with fewer visits than this is slipping",
            )}
            {number(
              "ptMinVisits",
              "Visits for a PT chance",
              "Visits in 30 days before we suggest personal training",
            )}
            {number(
              "runwayWarnMonths",
              "Warn when money lasts less than (months)",
              "Shows a cash warning",
              { step: "0.5" },
            )}
            {number(
              "graceDays",
              "Grace days after a plan ends",
              "A member who comes back within this time counts as renewed",
            )}
          </div>
        </Group>

        <Group title="AI summary">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <label htmlFor="cfo-ai" className="text-label">
                Write a weekly AI summary
              </label>
              <p className="text-meta mt-0.5">
                Only totals are sent to the AI. Never names or phone numbers.
              </p>
            </div>
            <Switch
              id="cfo-ai"
              checked={form.aiEnabled}
              onCheckedChange={(v) => set("aiEnabled", v)}
            />
          </div>
          <Field label="Language of the summary" htmlFor="cfo-language">
            <Select value={form.language} onValueChange={(v) => set("language", v as CfoLanguage)}>
              <SelectTrigger id="cfo-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CFO_LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Group>
      </div>
    </FormDialog>
  );
}
