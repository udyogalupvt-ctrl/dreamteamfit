import { Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft",
        className,
      )}
      aria-hidden
    >
      <Dumbbell className="size-5" strokeWidth={2.5} />
    </span>
  );
}
