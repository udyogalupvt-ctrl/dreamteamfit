import { SEGMENT_META, SEGMENTS, type Segment } from "@/lib/member-segments";
import { cn } from "@/lib/utils";

/** Horizontal bar chart of the member groups. Each bar is a button that opens that list. */
export function SegmentChart({
  counts,
  selected,
  onSelect,
  total,
}: {
  counts: Record<Segment, number>;
  selected?: Segment | null;
  onSelect: (s: Segment) => void;
  total: number;
}) {
  const max = Math.max(1, ...SEGMENTS.map((s) => counts[s]));
  return (
    <div className="grid gap-2" role="list" aria-label="Members by group">
      {SEGMENTS.map((s) => {
        const n = counts[s];
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <button
            key={s}
            type="button"
            role="listitem"
            onClick={() => onSelect(s)}
            aria-pressed={selected === s}
            aria-label={`${SEGMENT_META[s].label}: ${n} members. Show the list.`}
            className={cn(
              "grid grid-cols-[8.5rem_1fr_3rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent sm:grid-cols-[11rem_1fr_4rem]",
              selected === s && "bg-accent ring-2 ring-primary",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{SEGMENT_META[s].label}</span>
              <span className="text-meta block truncate">{SEGMENT_META[s].hint}</span>
            </span>
            <span className="h-3.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", SEGMENT_META[s].color)}
                style={{ width: `${n ? Math.max(4, (n / max) * 100) : 0}%` }}
              />
            </span>
            <span className="text-right font-bold tabular-nums">
              {n}
              <span className="text-meta block font-normal">{pct}%</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
