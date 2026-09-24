import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";
import { FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

/** Largest side of the saved photo; plenty for a face and small to upload on mobile data. */
const OUT_SIZE = 800;

/** Cuts the chosen square out of the picture and returns it as a JPEG file. */
async function cropToFile(src: string, area: Area): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't read this picture. Try another one."));
    i.src = src;
  });
  const size = Math.min(OUT_SIZE, Math.round(area.width));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't crop the picture on this device.");
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("Couldn't crop the picture on this device.");
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

/**
 * Square (1:1) crop before a photo is uploaded: drag to move, pinch or use the slider to zoom.
 * `src` is an object URL of the picture; null = closed.
 */
export function SquareCropDialog({
  src,
  onCancel,
  onDone,
}: {
  src: string | null;
  onCancel: () => void;
  onDone: (file: File) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const done = async () => {
    if (!src || !area) return;
    setBusy(true);
    setError("");
    try {
      onDone(await cropToFile(src, area));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={!!src}
      onOpenChange={(o) => !o && onCancel()}
      title="Adjust the photo"
      description="Drag to move, pinch or use the slider to zoom. The square is what gets saved."
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void done()} disabled={busy || !area}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Use this photo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative h-72 w-full overflow-hidden rounded-xl bg-black sm:h-80">
          {src ? (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, px) => setArea(px)}
            />
          ) : null}
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="shrink-0 font-medium">Zoom</span>
          <Slider
            min={1}
            max={3}
            step={0.05}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0] ?? 1)}
            aria-label="Zoom"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
