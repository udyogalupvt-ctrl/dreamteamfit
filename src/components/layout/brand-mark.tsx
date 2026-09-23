import { cn } from "@/lib/utils";
import brandLogo from "@/assets/rebuild-fitness-logo.png.asset.json";

export function BrandMark({ className, imageClassName }: { className?: string; imageClassName?: string }) {
  return (
    <span className={cn("grid size-11 shrink-0 place-items-center", className)}>
      <img
        src={brandLogo.url}
        alt="Rebuild Fitness"
        className={cn("size-full object-contain", imageClassName)}
      />
    </span>
  );
}
