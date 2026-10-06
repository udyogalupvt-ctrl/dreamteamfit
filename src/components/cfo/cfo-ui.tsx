import type { CfoTone } from "@/lib/cfo/types";
import { cn } from "@/lib/utils";
import { TONE_WORD } from "./cfo-format";

const TONE_PILL: Record<CfoTone, string> = {
  good: "bg-success/15 text-success ring-success/25",
  warn: "bg-warning/20 text-warning ring-warning/30",
  bad: "bg-destructive/15 text-destructive ring-destructive/25",
  none: "bg-muted text-muted-foreground ring-border",
};

export function ToneWord({ tone, label }: { tone: CfoTone; label?: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        TONE_PILL[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label ?? TONE_WORD[tone]}
    </span>
  );
}
