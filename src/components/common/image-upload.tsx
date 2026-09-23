import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { uploadImage, validateImageFile, type UploadedImage } from "@/lib/cloudinary";

type Status = "idle" | "uploading" | "success" | "error";

interface ImageUploadProps {
  value?: UploadedImage | null;
  onChange?: (image: UploadedImage | null) => void;
  folder?: string;
  label?: string;
  hint?: string;
  className?: string;
}

/** Reusable Cloudinary uploader: preview, progress, success/error, remove & replace. */
export function ImageUpload({
  value = null,
  onChange,
  folder = "rebuild-fitness",
  label = "Image",
  hint = "JPG, PNG or WEBP up to 5 MB",
  className,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<UploadedImage | null>(value);
  const [status, setStatus] = useState<Status>(value ? "success" : "idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(value?.url ?? null);

  const handleFile = useCallback(
    async (file: File) => {
      const invalid = validateImageFile(file);
      if (invalid) {
        setStatus("error");
        setError(invalid);
        toast.error(invalid);
        return;
      }
      setError(null);
      setProgress(0);
      setStatus("uploading");
      setPreview(URL.createObjectURL(file));
      try {
        const uploaded = await uploadImage(file, { folder, onProgress: setProgress });
        setImage(uploaded);
        setPreview(uploaded.url);
        setStatus("success");
        onChange?.(uploaded);
        toast.success("Image uploaded");
      } catch (err) {
        const message = (err as Error).message;
        setStatus("error");
        setError(message);
        toast.error(message);
      }
    },
    [folder, onChange],
  );

  const reset = () => {
    setImage(null);
    setPreview(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
    onChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className={cn(
            "relative grid aspect-square w-full shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 sm:size-32",
            status === "error" && "border-destructive/60",
          )}
        >
          {preview ? (
            <img src={preview} alt="Selected upload preview" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
          {status === "uploading" ? (
            <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[2px]">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-label">{label}</p>
            <p className="text-meta mt-0.5">{hint}</p>
          </div>

          {status === "uploading" ? (
            <div className="space-y-1.5">
              <Progress value={progress} aria-label="Upload progress" />
              <p className="text-meta">Uploading… {progress}%</p>
            </div>
          ) : null}

          {status === "success" && image ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Uploaded successfully
            </p>
          ) : null}

          {status === "error" && error ? (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertCircle className="size-4" aria-hidden /> {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={preview ? "outline" : "default"}
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={status === "uploading"}
            >
              {preview ? <RefreshCw aria-hidden /> : <ImagePlus aria-hidden />}
              {preview ? "Replace" : "Upload image"}
            </Button>
            {preview ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={status === "uploading"}
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={`Upload ${label}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
