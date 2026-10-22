import { useEffect, useId, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CLOUDINARY_CLIENT_FOLDER } from "@/constants/navigation";
import {
  BODY_LIMITS,
  BODY_METRICS,
  MEASUREMENT_KEYS,
  cleanBodyEntry,
  validateBodyEntry,
} from "@/lib/body-progress";
import { uploadImage } from "@/lib/cloudinary";
import type { BodyEntry, BodyEntryInput } from "@/types/models";

type Form = {
  date: string;
  weightKg: string;
  bodyFatPct: string;
  measurements: Record<(typeof MEASUREMENT_KEYS)[number], string>;
  photos: string[];
  note: string;
};

const num = (v: number) => (v ? String(v) : "");
const formOf = (e: BodyEntry | null, today: string): Form => ({
  date: e?.date ?? today,
  weightKg: num(e?.weightKg ?? 0),
  bodyFatPct: num(e?.bodyFatPct ?? 0),
  measurements: Object.fromEntries(
    MEASUREMENT_KEYS.map((k) => [k, num(e?.measurements[k] ?? 0)]),
  ) as Form["measurements"],
  photos: e?.photos ?? [],
  note: e?.note ?? "",
});

const info = (key: string) => BODY_METRICS.find((m) => m.key === key)!;

/** Add or change one body progress entry: any of the numbers, up to 3 photos, a note. */
export function BodyEntryDialog({
  open,
  onOpenChange,
  entry,
  today,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = a new entry. */
  entry: BodyEntry | null;
  today: string;
  onSave: (input: BodyEntryInput) => Promise<void>;
}) {
  const id = useId();
  const [form, setForm] = useState<Form>(() => formOf(entry, today));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setForm(formOf(entry, today));
      setError("");
    }
  }, [open, entry, today]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const numberInput = (key: string, value: string, onChange: (v: string) => void) => {
    const m = info(key);
    return (
      <Field label={`${m.label} (${m.unit})`} htmlFor={`${id}-${key}`}>
        <Input
          id={`${id}-${key}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder={m.key === "weightKg" ? "e.g. 72.5" : ""}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tabular-nums"
        />
      </Field>
    );
  };

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setUploading(0);
    try {
      const img = await uploadImage(file, {
        folder: CLOUDINARY_CLIENT_FOLDER,
        onProgress: setUploading,
      });
      setForm((f) => ({ ...f, photos: [...f.photos, img.url].slice(0, BODY_LIMITS.photos) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo didn't upload. Try again.");
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    const input = cleanBodyEntry(form);
    const problem = validateBodyEntry(input, today);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await onSave(input);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={entry ? "Change entry" : "Add progress"}
      description="Fill only what you measured. Every number is optional."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || uploading !== null}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {entry ? "Save changes" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Date" htmlFor={`${id}-date`} required>
          <Input
            id={`${id}-date`}
            type="date"
            max={today}
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {numberInput("weightKg", form.weightKg, (v) => set({ weightKg: v }))}
          {numberInput("bodyFatPct", form.bodyFatPct, (v) => set({ bodyFatPct: v }))}
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-label mb-2">Measurements (cm)</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {MEASUREMENT_KEYS.map((k) => (
              <Field key={k} label={info(k).label} htmlFor={`${id}-${k}`}>
                <Input
                  id={`${id}-${k}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.measurements[k]}
                  onChange={(e) =>
                    set({ measurements: { ...form.measurements, [k]: e.target.value } })
                  }
                  className="tabular-nums"
                />
              </Field>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-2">
          <p className="text-label">Photos</p>
          <div className="flex flex-wrap gap-2">
            {form.photos.map((url, i) => (
              <div key={url} className="relative">
                <img
                  src={url}
                  alt={`Progress photo ${i + 1}`}
                  className="size-20 rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => set({ photos: form.photos.filter((p) => p !== url) })}
                  className="absolute -top-2 -right-2 grid size-7 cursor-pointer place-items-center rounded-full border border-border bg-background shadow-sm hover:bg-accent"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            {form.photos.length < BODY_LIMITS.photos ? (
              <label
                className="grid size-20 cursor-pointer place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-accent focus-within:ring-2 focus-within:ring-ring"
                aria-busy={uploading !== null}
              >
                {uploading !== null ? (
                  <span className="text-xs font-semibold tabular-nums">{uploading}%</span>
                ) : (
                  <span className="grid place-items-center gap-0.5 text-xs">
                    <ImagePlus className="size-5" aria-hidden />
                    Add photo
                  </span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="sr-only"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    void addPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
          <p className="text-meta">
            Up to {BODY_LIMITS.photos}. Only the member, their trainer and the gym see them.
          </p>
        </div>

        <Field label="Note" htmlFor={`${id}-note`}>
          <Textarea
            id={`${id}-note`}
            value={form.note}
            maxLength={BODY_LIMITS.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="e.g. Morning, before breakfast"
            className="field-sizing-content min-h-16"
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
