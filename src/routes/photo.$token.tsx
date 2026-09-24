import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Camera, CheckCircle2, ImageOff, Images, Loader2 } from "lucide-react";
import { SquareCropDialog } from "@/components/common/square-crop-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CLOUDINARY_CLIENT_FOLDER } from "@/constants/navigation";
import { uploadImage, validateImageFile } from "@/lib/cloudinary";

export const Route = createFileRoute("/photo/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Upload your photo" },
      { name: "description", content: "Add your profile photo for your gym membership." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PhotoUploadPage,
});

type Info = { firstName: string; gymName: string; logoUrl: string };

/** Member-facing page: take or pick a photo, and it is saved on their membership. */
function PhotoUploadPage() {
  const { token } = Route.useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "invalid" | "uploading" | "done" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState("");
  const selfie = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  // The picked photo is cropped to a square first; only that small square is uploaded.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const closeCrop = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };
  const pick = (f: File) => {
    if (!f.type.startsWith("image/")) {
      setError("Choose a photo (JPG, PNG or WEBP).");
      setState("error");
      return;
    }
    setCropSrc(URL.createObjectURL(f));
  };

  useEffect(() => {
    void fetch(`/api/member-photo?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setInfo((await r.json()) as Info);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const upload = async (file: File) => {
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      setState("error");
      return;
    }
    setError("");
    setPreview(URL.createObjectURL(file));
    setProgress(0);
    setState("uploading");
    try {
      const img = await uploadImage(file, {
        folder: CLOUDINARY_CLIENT_FOLDER,
        onProgress: setProgress,
      });
      const r = await fetch("/api/member-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, url: img.url }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Couldn't save the photo.");
      setState("done");
    } catch (e) {
      setError((e as Error).message || "Upload failed. Try again.");
      setState("error");
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="surface-card w-full max-w-sm space-y-5 p-6 text-center">
        {info?.logoUrl ? (
          <img src={info.logoUrl} alt="" className="mx-auto size-16 rounded-xl object-contain" />
        ) : null}
        {state === "loading" ? (
          <Loader2 className="mx-auto size-8 animate-spin" aria-label="Loading" />
        ) : state === "invalid" ? (
          <>
            <ImageOff className="mx-auto size-10 text-muted-foreground" aria-hidden />
            <h1 className="text-xl font-bold">This link is not valid</h1>
            <p className="text-sm text-muted-foreground">
              Your photo may already be saved. Ask the gym front desk for a new link.
            </p>
          </>
        ) : state === "done" ? (
          <>
            {preview ? (
              <img
                src={preview}
                alt="Your photo"
                className="mx-auto size-32 rounded-full object-cover"
              />
            ) : null}
            <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
            <h1 className="text-xl font-bold">Photo saved. Thank you!</h1>
            <p className="text-sm text-muted-foreground">See you at {info?.gymName}.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Hi {info?.firstName}, add your photo</h1>
            <p className="text-sm text-muted-foreground">
              {info?.gymName} needs a clear photo of your face for your membership.
            </p>
            {preview ? (
              <img
                src={preview}
                alt="Your photo"
                className="mx-auto size-32 rounded-full object-cover"
              />
            ) : null}
            {state === "uploading" ? (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm">Uploading…</p>
              </div>
            ) : (
              <>
                {[
                  { ref: selfie, capture: "user" as const, label: "Take a selfie" },
                  { ref: gallery, capture: undefined, label: "Choose from gallery" },
                ].map((x) => (
                  <input
                    key={x.label}
                    ref={x.ref}
                    type="file"
                    accept="image/*"
                    capture={x.capture}
                    className="sr-only"
                    // The visible buttons below open these; hidden so each is announced once.
                    aria-hidden
                    tabIndex={-1}
                    data-picker={x.label}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) pick(f);
                      e.target.value = "";
                    }}
                  />
                ))}
                <Button
                  size="lg"
                  className="h-14 w-full text-base"
                  onClick={() => selfie.current?.click()}
                >
                  <Camera aria-hidden /> Take a selfie
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 w-full text-base"
                  onClick={() => gallery.current?.click()}
                >
                  <Images aria-hidden /> Choose from gallery
                </Button>
                {error ? (
                  <p role="alert" className="text-sm font-semibold text-destructive">
                    {error}
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      <SquareCropDialog
        src={cropSrc}
        onCancel={closeCrop}
        onDone={(f) => {
          closeCrop();
          void upload(f);
        }}
      />
    </main>
  );
}
