import { cn } from "@/lib/utils";
import { toneIcon } from "@/lib/tone";
import type { StatTone } from "@/types";

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        toneIcon[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
