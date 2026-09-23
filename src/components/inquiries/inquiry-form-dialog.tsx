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
import { INQUIRY_STATUS_META, SOURCE_LABELS } from "@/lib/format";
import { createInquiry, updateInquiry, type InquiryInput } from "@/services/inquiries.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { INQUIRY_STATUSES, LEAD_SOURCES, type Inquiry } from "@/types/models";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the full name").max(80, "Name is too long"),
  phone: phoneSchema,
  email: z.string().trim().max(120).email("Enter a valid email").or(z.literal("")),
  fitnessGoal: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
});

const EMPTY: InquiryInput = {
  name: "",
  phone: "",
  email: "",
  source: "walk_in",
  fitnessGoal: "",
  notes: "",
  status: "new",
  nextFollowUpDate: null,
};

export function InquiryFormDialog({
  open,
  onOpenChange,
  inquiry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiry?: Inquiry | null;
}) {
  const [form, setForm] = useState<InquiryInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(inquiry ? { ...EMPTY, ...inquiry } : EMPTY);
    setErrors({});
  }, [open, inquiry]);

  const set = <K extends keyof InquiryInput>(k: K, v: InquiryInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

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
      toast.success(inquiry ? "Inquiry updated" : "Inquiry created", { description: payload.name });
      onOpenChange(false);
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const statuses = INQUIRY_STATUSES.filter((s) => s !== "converted" || inquiry?.status === "converted");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={inquiry ? "Edit inquiry" : "New inquiry"}
      description="Capture a lead so your team can follow up and convert."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="inquiry-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {inquiry ? "Save changes" : "Create inquiry"}
          </Button>
        </>
      }
    >
      <form id="inquiry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Full name" htmlFor="i-name" error={errors["name"]} required>
          <Input id="i-name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors["name"]} />
        </Field>
        <Field label="Phone" htmlFor="i-phone" error={errors["phone"]} required>
          <Input
            id="i-phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="98765 43210"
            aria-invalid={!!errors["phone"]}
          />
        </Field>
        <Field label="Email" htmlFor="i-email" error={errors["email"]}>
          <Input id="i-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Source" htmlFor="i-source">
          <Select value={form.source} onValueChange={(v) => set("source", v as InquiryInput["source"])}>
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
        <Field label="Fitness goal" htmlFor="i-goal" error={errors["fitnessGoal"]}>
          <Input
            id="i-goal"
            value={form.fitnessGoal}
            onChange={(e) => set("fitnessGoal", e.target.value)}
            placeholder="Weight loss, strength…"
          />
        </Field>
        <Field label="Status" htmlFor="i-status">
          <Select
            value={form.status}
            onValueChange={(v) => set("status", v as InquiryInput["status"])}
            disabled={inquiry?.status === "converted"}
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
        <Field label="Next follow-up" htmlFor="i-follow" className="sm:col-span-2">
          <Input
            id="i-follow"
            type="date"
            value={form.nextFollowUpDate ?? ""}
            onChange={(e) => set("nextFollowUpDate", e.target.value || null)}
          />
        </Field>
        <Field label="Notes" htmlFor="i-notes" className="sm:col-span-2" error={errors["notes"]}>
          <Textarea id="i-notes" rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </form>
    </FormDialog>
  );
}
