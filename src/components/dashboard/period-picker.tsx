import { useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardPeriod } from "@/hooks/use-dashboard-metrics";
import { addDaysISO, formatDateISO, todayISO } from "@/lib/format";

const CHOICES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last5", "Last 5 days"],
  ["month", "This month"],
  ["date", "Pick a date…"],
  ["range", "Date range…"],
] as const;
type Choice = (typeof CHOICES)[number][0];

/** "Showing: Today / Yesterday / Last 5 days / This month / a date / a range" for the dashboard. */
export function usePeriodPicker() {
  const today = todayISO();
  const [choice, setChoice] = useState<Choice>("today");
  const [day, setDay] = useState(addDaysISO(today, -1));
  const [from, setFrom] = useState(addDaysISO(today, -6));
  const [to, setTo] = useState(today);

  const period = useMemo<DashboardPeriod>(() => {
    const clamp = (d: string) => (d && d <= today ? d : today);
    const one = (d: string, label: string) => ({ from: d, to: d, label, isToday: d === today });
    if (choice === "yesterday") return one(addDaysISO(today, -1), "yesterday");
    if (choice === "last5")
      return { from: addDaysISO(today, -4), to: today, label: "last 5 days", isToday: false };
    if (choice === "month")
      return {
        from: format(startOfMonth(new Date()), "yyyy-MM-dd"),
        to: today,
        label: "this month",
        isToday: false,
      };
    if (choice === "date") {
      const d = clamp(day);
      return d === today ? one(d, "today") : one(d, formatDateISO(d));
    }
    if (choice === "range") {
      let [a, b] = [clamp(from), clamp(to)];
      if (a > b) [a, b] = [b, a];
      return a === b && a === today
        ? one(a, "today")
        : { from: a, to: b, label: `${formatDateISO(a)} – ${formatDateISO(b)}`, isToday: false };
    }
    return one(today, "today");
  }, [choice, day, from, to, today]);

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={choice} onValueChange={(v) => setChoice(v as Choice)}>
        <SelectTrigger className="w-44" aria-label="Show numbers for">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHOICES.map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choice === "date" ? (
        <Input
          type="date"
          aria-label="Date"
          className="w-40"
          max={today}
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      ) : null}
      {choice === "range" ? (
        <>
          <Input
            type="date"
            aria-label="From"
            className="w-40"
            max={today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-meta">to</span>
          <Input
            type="date"
            aria-label="To"
            className="w-40"
            max={today}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </>
      ) : null}
    </div>
  );
  return { period, picker };
}
