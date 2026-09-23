import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { ImageUpload } from "@/components/common/image-upload";
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
import { SOURCE_LABELS, normalizePhone, todayISO } from "@/lib/format";
import {
  createClient,
  findClientsByPhone,
  updateClient,
  type ClientInput,
} from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { GENDERS, LEAD_SOURCES, type Client } from "@/types/models";

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .refine((v) => /^[+\d][\d\s-]*$/.test(v), "Use digits only (spaces, + and - allowed)")
  .refine((v) => {
    const n = normalizePhone(v).length;
    return n >= 10 && n <= 13;
  }, "Enter a valid 10-digit phone number");

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name").max(80, "Name is too long"),
  phone: phoneSchema,
  email: z.string().trim().max(120).email("Enter a valid email").or(z.literal("")),
  dateOfBirth: z
    .string()
    .refine((v) => !v || v <= todayISO(), "Date of birth can't be in the future"),
  address: z.string().trim().max(300),
  emergencyContact: z.string().trim().max(120),
  notes: z.string().trim().max(1000),
});

type Errors = Partial<Record<string, string>>;

const EMPTY: ClientInput = {
  fullName: "",
  phone: "",
  email: "",
  profilePhotoUrl: null,
  dateOfBirth: null,
  gender: "unspecified",
  address: "",
  emergencyContact: "",
  source: "walk_in",
  notes: "",
  status: "active",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client | null;
  /** Prefill + link when converting an inquiry. */
  initial?: Partial<ClientInput>;
  inquiryId?: string | null;
  title?: string;
  description?: string;
  intro?: ReactNode;
  submitLabel?: string;
}

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
  initial,
  inquiryId = null,
  title,
  description,
  intro,
  submitLabel,
}: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState<ClientInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<Client[]>([]);
  const [ackDuplicate, setAckDuplicate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(client ? { ...EMPTY, ...client } : { ...EMPTY, ...initial });
    setErrors({});
    setDuplicates([]);
    setAckDuplicate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  // Proactively warn about duplicates (e.g. when converting an inquiry).
  useEffect(() => {
    if (!open || client || !initial?.phone) return;
    findClientsByPhone(initial.phone).then(setDuplicates).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const activeDuplicate = duplicates.find((d) => d.status === "active");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({ ...form, dateOfBirth: form.dateOfBirth ?? "" });
    if (!parsed.success) {
      const next: Errors = {};
      parsed.error.issues.forEach((i) => (next[String(i.path[0])] ??= i.message));
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const phoneChanged = !client || normalizePhone(client.phone) !== normalizePhone(form.phone);
      if (phoneChanged) {
        const dups = await findClientsByPhone(form.phone, client?.id);
        setDuplicates(dups);
        const active = dups.find((d) => d.status === "active");
        if (active && form.status === "active") {
          setSaving(false);
          return; // blocked — inline warning shows the existing client
        }
        if (dups.length && !ackDuplicate) {
          setAckDuplicate(true);
          setSaving(false);
          return; // first click shows the warning, second confirms
        }
      }
      const payload: ClientInput = {
        ...form,
        email: form.email.trim(),
        dateOfBirth: form.dateOfBirth || null,
      };
      if (client) {
        await updateClient(client.id, payload);
        toast.success("Client updated", { description: payload.fullName });
        onOpenChange(false);
      } else {
        const id = await createClient(payload, inquiryId);
        toast.success(inquiryId ? "Inquiry converted to client" : "Client created", {
          description: payload.fullName,
        });
        onOpenChange(false);
        void navigate({ to: "/clients/$clientId", params: { clientId: id } });
      }
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? (client ? "Edit client" : "Create client")}
      description={description ?? "Member details used across memberships, billing and attendance."}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="client-form" disabled={saving || (!!activeDuplicate && form.status === "active")}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {ackDuplicate && duplicates.length
              ? "Create anyway"
              : (submitLabel ?? (client ? "Save changes" : "Create client"))}
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} className="grid gap-5" noValidate>
        {intro}

        {duplicates.length ? (
          <div
            role="alert"
            className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                {activeDuplicate
                  ? "An active client already uses this phone number"
                  : "A client with this phone number already exists"}
              </p>
              <ul className="space-y-0.5">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: d.id }}
                      className="font-medium underline underline-offset-2"
                      onClick={() => onOpenChange(false)}
                    >
                      {d.fullName} · {d.clientCode}
                    </Link>{" "}
                    <span className="text-muted-foreground">({d.status})</span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                {activeDuplicate
                  ? "Open the existing profile instead of creating a duplicate."
                  : "Check this isn't the same person before continuing."}
              </p>
            </div>
          </div>
        ) : null}

        {!inquiryId ? (
          <ImageUpload
            label="Profile photo"
            folder="forge/clients"
            value={
              form.profilePhotoUrl
                ? { url: form.profilePhotoUrl, publicId: "", width: 0, height: 0, format: "" }
                : null
            }
            onChange={(img) => set("profilePhotoUrl", img?.url ?? null)}
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="c-name" error={errors["fullName"]} required>
            <Input
              id="c-name"
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              autoComplete="off"
              aria-invalid={!!errors["fullName"]}
            />
          </Field>
          <Field label="Phone" htmlFor="c-phone" error={errors["phone"]} required>
            <Input
              id="c-phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => {
                set("phone", e.target.value);
                setDuplicates([]);
                setAckDuplicate(false);
              }}
              placeholder="98765 43210"
              aria-invalid={!!errors["phone"]}
            />
          </Field>
          <Field label="Email" htmlFor="c-email" error={errors["email"]}>
            <Input
              id="c-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Date of birth" htmlFor="c-dob" error={errors["dateOfBirth"]}>
            <Input
              id="c-dob"
              type="date"
              max={todayISO()}
              value={form.dateOfBirth ?? ""}
              onChange={(e) => set("dateOfBirth", e.target.value || null)}
            />
          </Field>
          <Field label="Gender" htmlFor="c-gender">
            <Select value={form.gender} onValueChange={(v) => set("gender", v as ClientInput["gender"])}>
              <SelectTrigger id="c-gender" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map((g) => (
                  <SelectItem key={g} value={g} className="capitalize">
                    {g === "unspecified" ? "Prefer not to say" : g[0]!.toUpperCase() + g.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Source" htmlFor="c-source">
            <Select value={form.source} onValueChange={(v) => set("source", v as ClientInput["source"])}>
              <SelectTrigger id="c-source" className="h-10 w-full">
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
          <Field label="Emergency contact" htmlFor="c-emergency" error={errors["emergencyContact"]}>
            <Input
              id="c-emergency"
              value={form.emergencyContact}
              onChange={(e) => set("emergencyContact", e.target.value)}
              placeholder="Name · phone"
            />
          </Field>
          <Field label="Status" htmlFor="c-status">
            <Select value={form.status} onValueChange={(v) => set("status", v as ClientInput["status"])}>
              <SelectTrigger id="c-status" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Address" htmlFor="c-address" className="sm:col-span-2">
            <Input
              id="c-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field label="Notes" htmlFor="c-notes" className="sm:col-span-2" error={errors["notes"]}>
            <Textarea
              id="c-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
      </form>
    </FormDialog>
  );
}
