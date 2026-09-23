import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DURATION_OPTIONS, formatDuration } from "@/lib/format";
import { createPackage, updatePackage } from "@/services/packages.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { PACKAGE_CATEGORIES, type GymPackage, type PackageCategory } from "@/types/models";

const schema = z.object({
  name: z.string().trim().min(2, "Enter a package name").max(60, "Keep it under 60 characters"),
  description: z.string().trim().max(300, "Keep it under 300 characters"),
  durationDays: z
    .number()
    .refine((v) => (DURATION_OPTIONS as readonly number[]).includes(v), "Choose a duration"),
  price: z
    .number({ invalid_type_error: "Enter a price" })
    .finite("Enter a valid price")
    .min(0, "Price can't be negative")
    .max(10_000_000, "Price is too high"),
  isActive: z.boolean(),
  category: z.enum(PACKAGE_CATEGORIES),
});

type Errors = Partial<Record<keyof z.infer<typeof schema>, string>>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pkg?: GymPackage | null;
}

export function PackageFormDialog({ open, onOpenChange, pkg }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<string>("30");
  const [price, setPrice] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [category, setCategory] = useState<PackageCategory>("Strength + Cardio");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(pkg?.name ?? "");
    setDescription(pkg?.description ?? "");
    setDuration(String(pkg?.durationDays ?? 30));
    setPrice(pkg ? String(pkg.price) : "");
    setIsActive(pkg?.isActive ?? true);
    setCategory(pkg?.category ?? "Strength + Cardio");
    setErrors({});
  }, [open, pkg]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({
      name,
      description,
      durationDays: Number(duration),
      price: price.trim() === "" ? Number.NaN : Number(price),
      isActive,
      category,
    });
    if (!parsed.success) {
      const next: Errors = {};
      parsed.error.issues.forEach((i) => (next[i.path[0] as keyof Errors] ??= i.message));
      setErrors(next);
      return;
    }
    setSaving(true);
    try {
      if (pkg) await updatePackage(pkg.id, parsed.data);
      else await createPackage(parsed.data);
      toast.success(pkg ? "Package updated" : "Package created", { description: parsed.data.name });
      onOpenChange(false);
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
      title={pkg ? "Edit package" : "Create package"}
      description="Packages define how long a membership lasts and what it costs."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="package-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pkg ? "Save changes" : "Create package"}
          </Button>
        </>
      }
    >
      <form id="package-form" onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Package name" htmlFor="pkg-name" error={errors.name} required>
          <Input
            id="pkg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Monthly"
            aria-invalid={!!errors.name}
          />
        </Field>
        <Field label="Category / training type" htmlFor="pkg-cat">
          <Select value={category} onValueChange={(v) => setCategory(v as PackageCategory)}>
            <SelectTrigger id="pkg-cat" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{PACKAGE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Description" htmlFor="pkg-desc" error={errors.description}>
          <Textarea
            id="pkg-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's included"
            rows={3}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duration" htmlFor="pkg-duration" error={errors.durationDays} required>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger id="pkg-duration" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days · {formatDuration(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Price (₹)" htmlFor="pkg-price" error={errors.price} required>
            <Input
              id="pkg-price"
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="999"
              aria-invalid={!!errors.price}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4">
          <div>
            <label htmlFor="pkg-active" className="text-label">
              Active
            </label>
            <p className="text-meta mt-0.5">Only active packages can be assigned to clients.</p>
          </div>
          <Switch id="pkg-active" checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </form>
    </FormDialog>
  );
}
