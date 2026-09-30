import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Sunrise,
  Sunset,
  type LucideIcon,
} from "lucide-react";
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

/** Part of the day from an arrival time ("HH:MM"), with its icon. */
export function sessionOf(hhmm: string): { label: string; Icon: LucideIcon } {
  const h = Number(hhmm.slice(0, 2));
  if (h >= 4 && h < 12) return { label: "Morning", Icon: Sunrise };
  if (h >= 12 && h < 16) return { label: "Afternoon", Icon: Sun };
  if (h >= 16 && h < 20) return { label: "Evening", Icon: Sunset };
  return { label: "Night", Icon: Moon };
}

/** "18:05" → "6:05 PM". */
export const clock12 = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => {
  const dt = new Date(`${d}T00:00:00Z`);
  return `${WEEKDAY[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
};

/**
 * Month grid (Monday first) with the days the member came in marked, each with the part of the
 * day they came (first thumb of the day), and the list of arrival times below.
 */
export function VisitsCalendar({
  visits,
  today,
  times = {},
}: {
  visits: string[];
  today: string;
  times?: Record<string, string>;
}) {
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
            aria-label={
              d
                ? `${d}${set.has(d) ? `: came in${times[d] ? ` at ${clock12(times[d])}` : ""}` : ""}`
                : undefined
            }
          >
            {d ? (
              <span className="flex flex-col items-center leading-none">
                {Number(d.slice(8))}
                {set.has(d) && times[d]
                  ? (() => {
                      const { Icon } = sessionOf(times[d]);
                      return <Icon className="mt-0.5 size-3" aria-hidden />;
                    })()
                  : null}
              </span>
            ) : (
              ""
            )}
          </li>
        ))}
      </ol>
      {Object.keys(times).length ? (
        <p className="text-meta mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
          {[
            ["Morning", Sunrise],
            ["Afternoon", Sun],
            ["Evening", Sunset],
            ["Night", Moon],
          ].map(([label, Icon]) => {
            const I = Icon as LucideIcon;
            return (
              <span key={label as string} className="inline-flex items-center gap-1">
                <I className="size-3.5" aria-hidden /> {label as string}
              </span>
            );
          })}
        </p>
      ) : null}
      {(() => {
        const list = visits.filter((v) => v.startsWith(month) && times[v]);
        if (!list.length) return null;
        return (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {list.map((d) => {
              const { label, Icon } = sessionOf(times[d]!);
              return (
                <li key={d} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="flex-1 font-semibold">{dayLabel(d)}</span>
                  <span className="tabular-nums">{clock12(times[d]!)}</span>
                  <span className="text-meta w-20 text-right">{label}</span>
                </li>
              );
            })}
          </ul>
        );
      })()}
    </section>
  );
}
