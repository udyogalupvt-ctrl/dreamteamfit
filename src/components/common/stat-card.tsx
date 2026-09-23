import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneBar, toneIcon } from "@/lib/tone";
import type { StatMetric } from "@/types";

export function StatCard({ metric, className }: { metric: StatMetric; className?: string }) {
  const { label, value, delta, hint, icon: Icon, tone } = metric;
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;

  return (
    <article
      className={cn(
        "surface-card group relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:p-5",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-0.5 opacity-70", toneBar[tone])}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-eyebrow min-w-0 truncate">{label}</p>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
            toneIcon[tone],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>

      <p className="text-stat mt-3">{value}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold",
              delta.direction === "up" && "bg-success/15 text-success",
              delta.direction === "down" && "bg-destructive/15 text-destructive",
              delta.direction === "flat" && "bg-muted text-muted-foreground",
            )}
          >
            <DeltaIcon className="size-3" aria-hidden />
            {delta.value}
          </span>
        ) : null}
        {hint ? <span className="text-meta truncate">{hint}</span> : null}
      </div>
    </article>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="surface-card p-5">
      <div className="flex items-start justify-between">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="size-9 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="mt-4 h-8 w-28 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-3 w-20 animate-pulse rounded bg-muted" />
    </div>
  );
}
