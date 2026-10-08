import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

const CLOUDINARY = "/image/upload/";

/** Uses a Cloudinary-transformed thumbnail when the URL is a Cloudinary upload. */
function thumb(url: string, size: number) {
  const i = url.indexOf(CLOUDINARY);
  if (i === -1) return url;
  return `${url.slice(0, i + CLOUDINARY.length)}f_auto,q_auto,w_${size * 2},h_${size * 2},c_fill,g_face/${url.slice(i + CLOUDINARY.length)}`;
}

/** The whole photo (not cropped), sized for a big screen. */
function full(url: string) {
  const i = url.indexOf(CLOUDINARY);
  if (i === -1) return url;
  return `${url.slice(0, i + CLOUDINARY.length)}f_auto,q_auto,w_1600,c_limit/${url.slice(i + CLOUDINARY.length)}`;
}

/**
 * Member photo. With `zoomable`, a tap on a real photo opens it full screen (Esc, the close
 * button or a tap outside the photo closes it); no photo = plain initials, nothing to open.
 */
export function ClientAvatar({
  name,
  url,
  size = 40,
  className,
  zoomable = false,
}: {
  name: string;
  url: string | null;
  size?: number;
  className?: string;
  zoomable?: boolean;
}) {
  const avatar = (
    <Avatar
      className={cn("shrink-0 ring-1 ring-border", className)}
      style={{ width: size, height: size }}
    >
      {url ? <AvatarImage src={thumb(url, size)} alt={name} className="object-cover" /> : null}
      <AvatarFallback className="bg-accent font-display text-sm font-bold text-accent-foreground">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
  if (!zoomable || !url) return avatar;
  return <ZoomablePhoto name={name} url={url} avatar={avatar} />;
}

function ZoomablePhoto({
  name,
  url,
  avatar,
}: {
  name: string;
  url: string;
  avatar: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Open ${name}'s photo full screen`}
        className="relative shrink-0 cursor-zoom-in rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
      >
        {avatar}
      </button>
      <PhotoViewer
        open={open}
        onOpenChange={setOpen}
        src={full(url)}
        title={name}
        alt={`${name}'s profile photo`}
      />
    </>
  );
}

/**
 * A photo full screen on a dark background, like a phone gallery: Esc, the close button or a
 * tap outside the photo closes it.
 */
export function PhotoViewer({
  open,
  onOpenChange,
  src,
  title,
  alt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  title: string;
  alt: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/95 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[60] flex flex-col outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 motion-reduce:animate-none"
          onClick={(e) => {
            // Portaled, but React still bubbles clicks to the page row underneath: stop them.
            e.stopPropagation();
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 text-white">
            <DialogPrimitive.Title className="min-w-0 truncate text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{alt}</DialogPrimitive.Description>
            <DialogPrimitive.Close
              aria-label="Close photo"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(env(safe-area-inset-bottom),1rem)]"
            onClick={(e) => {
              if (e.target === e.currentTarget) onOpenChange(false);
            }}
          >
            <img
              src={src}
              alt={alt}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl select-none"
              draggable={false}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
