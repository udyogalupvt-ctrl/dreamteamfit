import { cn } from "@/lib/utils";

/** Served from /public so it loads on any host. */
export const BRAND_LOGO_URL = "/logo-256.png";

export function BrandMark({ className, imageClassName }: { className?: string; imageClassName?: string }) {
  return (
    <span className={cn("grid size-11 shrink-0 place-items-center", className)}>
      <img src={BRAND_LOGO_URL} alt="Rebuild Fitness" className={cn("size-full object-contain", imageClassName)} />
    </span>
  );
}
