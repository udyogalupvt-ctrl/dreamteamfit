import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shiftDate } from "@/constants/portal";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Month grid (Monday first) with the days the member came in marked. */
export function VisitsCalendar({ visits, today }: { visits: string[]; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const set = useMemo(() => new Set(visits), [visits]);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => ""),
    ...Array.from({ length: daysInMonth }, (_, i) => shiftDate(first, i)),
  ];
  const count = visits.filter((v) => v.startsWith(month)).length;
  const move = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const earliest = visits[visits.length - 1]?.slice(0, 7) ?? today.slice(0, 7);
  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => move(-1)}
          disabled={month <= earliest}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div className="text-center">
          <p className="font-bold">
            {MONTHS[m - 1]} {y}
          </p>
          <p className="text-meta">
            {count} visit{count === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => move(1)}
          disabled={month >= today.slice(0, 7)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <ol className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => (
          <li
            key={d || `x${i}`}
            className={cn(
              "grid aspect-square place-items-center rounded-lg text-sm tabular-nums",
              !d && "invisible",
              set.has(d) && "bg-success font-bold text-success-foreground",
              d === today && !set.has(d) && "ring-2 ring-primary",
              d > today && "text-muted-foreground/50",
            )}
            aria-label={d ? `${d}${set.has(d) ? ": came in" : ""}` : undefined}
          >
            {d ? Number(d.slice(8)) : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
