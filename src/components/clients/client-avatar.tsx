import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/format";
import { cloudinaryUrl } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";

/** Uses a Cloudinary-transformed thumbnail when the URL is a Cloudinary upload. */
function thumb(url: string, size: number) {
  const marker = "/image/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  return `${url.slice(0, i + marker.length)}f_auto,q_auto,w_${size * 2},h_${size * 2},c_fill,g_face/${url.slice(i + marker.length)}`;
}

export function ClientAvatar({
  name,
  url,
  size = 40,
  className,
}: {
  name: string;
  url: string | null;
  size?: number;
  className?: string;
}) {
  void cloudinaryUrl;
  return (
    <Avatar className={cn("shrink-0 ring-1 ring-border", className)} style={{ width: size, height: size }}>
      {url ? <AvatarImage src={thumb(url, size)} alt={name} className="object-cover" /> : null}
      <AvatarFallback className="bg-accent font-display text-sm font-bold text-accent-foreground">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
