import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { phoneSchema } from "@/components/clients/client-form-dialog";
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
import {
  INQUIRY_STATUS_META,
  SOURCE_LABELS,
  addDaysISO,
  normalizePhone,
  todayISO,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { createInquiry, updateInquiry, type InquiryInput } from "@/services/inquiries.service";
import { findClientsByPhone } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { INQUIRY_STATUSES, LEAD_SOURCES, type Inquiry } from "@/types/models";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(80, "Name is too long"),
  phone: phoneSchema,
  email: z.string().trim().max(120).email("Enter a valid email").or(z.literal("")),
  fitnessGoal: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
});

const GOALS = ["Weight loss", "Muscle gain", "General fitness", "Strength", "PT enquiry"];
const CALL_WHEN = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

const emptyInquiry = (): InquiryInput => ({
  name: "",
  phone: "",
  email: "",
  source: "walk_in",
  fitnessGoal: "",
  notes: "",
  status: "new",
  nextFollowUpDate: addDaysISO(todayISO(), 1),
});

export function InquiryFormDialog({
  open,
  onOpenChange,
  inquiry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiry?: Inquiry | null;
}) {
  const [form, setForm] = useState<InquiryInput>(emptyInquiry);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [memberHint, setMemberHint] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(inquiry ? { ...emptyInquiry(), ...inquiry } : emptyInquiry());
    setErrors({});
    setMemberHint("");
  }, [open, inquiry]);

  const set = <K extends keyof InquiryInput>(k: K, v: InquiryInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const checkPhone = async () => {
    if (inquiry || normalizePhone(form.phone).length < 10) return;
    const found = await findClientsByPhone(form.phone).catch(() => []);
    setMemberHint(
      found[0] ? `${found[0].fullName} is already a member (${found[0].clientCode}).` : "",
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (next[String(i.path[0])] ??= i.message));
      setErrors(next);
      return;
    }
    setSaving(true);
    try {
      const payload: InquiryInput = {
        ...form,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        nextFollowUpDate: form.nextFollowUpDate || null,
      };
      if (inquiry) await updateInquiry(inquiry.id, payload);
      else await createInquiry(payload);
      toast.success(inquiry ? "Inquiry updated" : "Inquiry saved", {
        description: payload.nextFollowUpDate
          ? `Follow-up call on ${payload.nextFollowUpDate}`
          : payload.name,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const statuses = INQUIRY_STATUSES.filter(
    (s) => s !== "converted" || inquiry?.status === "converted",
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={inquiry ? "Edit inquiry" : "New inquiry"}
      {...(inquiry
        ? {}
        : {
            description:
              "Someone visited or called? Save them here and we'll remind you to call back.",
          })}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="lg" form="inquiry-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {inquiry ? "Save changes" : "Save inquiry"}
          </Button>
        </>
      }
    >
      <form id="inquiry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" htmlFor="i-name" error={errors["name"]} required>
          <Input
            id="i-name"
            autoComplete="off"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={!!errors["name"]}
          />
        </Field>
        <Field
          label="Mobile"
          htmlFor="i-phone"
          error={errors["phone"]}
          hint={memberHint || undefined}
          required
        >
          <Input
            id="i-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            onBlur={() => void checkPhone()}
            placeholder="98765 43210"
            aria-invalid={!!errors["phone"]}
          />
        </Field>
        <Field label="Came through" htmlFor="i-source">
          <Select
            value={form.source}
            onValueChange={(v) => set("source", v as InquiryInput["source"])}
          >
            <SelectTrigger id="i-source" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {inquiry ? (
          <Field label="Status" htmlFor="i-status">
            <Select
              value={form.status}
              onValueChange={(v) => set("status", v as InquiryInput["status"])}
              disabled={inquiry.status === "converted"}
            >
              <SelectTrigger id="i-status" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {INQUIRY_STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field label="Looking for" htmlFor="i-goal" error={errors["fitnessGoal"]}>
            <Input
              id="i-goal"
              list="i-goals"
              value={form.fitnessGoal}
              onChange={(e) => set("fitnessGoal", e.target.value)}
              placeholder="Weight loss, PT…"
            />
            <datalist id="i-goals">
              {GOALS.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
        )}
        <Field label="Call them back" htmlFor="i-follow" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {CALL_WHEN.map((c) => {
              const d = addDaysISO(todayISO(), c.days);
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => set("nextFollowUpDate", d)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                    form.nextFollowUpDate === d
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <Input
            id="i-follow"
            type="date"
            value={form.nextFollowUpDate ?? ""}
            onChange={(e) => set("nextFollowUpDate", e.target.value || null)}
          />
        </Field>
        {inquiry ? (
          <Field label="Looking for" htmlFor="i-goal" error={errors["fitnessGoal"]}>
            <Input
              id="i-goal"
              value={form.fitnessGoal}
              onChange={(e) => set("fitnessGoal", e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Notes" htmlFor="i-notes" className="sm:col-span-2" error={errors["notes"]}>
          <Textarea
            id="i-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Budget, timing, questions they asked…"
          />
        </Field>
      </form>
    </FormDialog>
  );
}
