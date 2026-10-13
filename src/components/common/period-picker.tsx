import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDaysISO, todayISO } from "@/lib/format";
import {
  DAY_CHOICES,
  choiceText,
  periodFor,
  periodSpan,
  type Period,
  type PeriodChoice,
} from "@/lib/periods";

/**
 * The one date filter every list and report uses: Today, Yesterday, 2 … 5 days back, This week,
 * This month, Pick a date…, From – to… (plus Last month / This year / All dates where a page asks).
 * The days chosen are always written next to it, so nobody has to work out "3 days back".
 */
export function usePeriodPicker(
  initial: PeriodChoice = "today",
  choices: PeriodChoice[] = DAY_CHOICES,
  ariaLabel = "Show dates",
) {
  const today = todayISO();
  const [choice, setChoice] = useState<PeriodChoice>(initial);
  const [day, setDay] = useState(addDaysISO(today, -1));
  const [from, setFrom] = useState(addDaysISO(today, -6));
  const [to, setTo] = useState(today);

  const period = useMemo<Period>(
    () => periodFor(choice, today, { day, from, to }),
    [choice, today, day, from, to],
  );
  const span = periodSpan(period, today);

  const picker = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <Select value={choice} onValueChange={(v) => setChoice(v as PeriodChoice)}>
        <SelectTrigger className="w-full sm:w-60" aria-label={ariaLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c} value={c}>
              {choiceText(c, today)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choice === "date" ? (
        <Input
          type="date"
          aria-label="Date"
          className="w-full sm:w-44"
          max={today}
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      ) : choice === "range" ? (
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex sm:w-auto">
          <Input
            type="date"
            aria-label="From"
            className="sm:w-44"
            max={today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-meta">to</span>
          <Input
            type="date"
            aria-label="To"
            className="sm:w-44"
            max={today}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      ) : span && !choice.startsWith("back") ? (
        <span className="text-meta tabular-nums" aria-live="polite">
          {span}
        </span>
      ) : null}
    </div>
  );
  return { period, picker, choice };
}
