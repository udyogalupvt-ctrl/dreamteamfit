import { Check, Dumbbell, Salad } from "lucide-react";
import {
  planLines,
  shiftDate,
  type PortalDiet,
  type PortalLog,
  type PortalWorkout,
} from "@/constants/portal";
import { cn } from "@/lib/utils";

/** The exercises of one workout day; a plan without days is one "today's workout" tick. */
export const dayItems = (w: PortalWorkout, dayIndex: number) => {
  const d = w.days[dayIndex];
  const lines = planLines(d?.exercises);
  return lines.length ? lines : ["Today's workout"];
};
export const mealItems = (d: PortalDiet) => {
  const lines = planLines(d.meals);
  return lines.length ? lines : ["Followed my diet today"];
};

/** Which day a member does next: today's pick, else the day after the last one they did. */
export function nextWorkoutDay(w: PortalWorkout, logs: PortalLog[], today: string) {
  const count = Math.max(1, w.days.length);
  const todays = logs.find((l) => l.date === today);
  if (todays && todays.workoutDone.length) return Math.min(todays.workoutDay, count - 1);
  const last = logs
    .filter((l) => l.date < today && l.workoutDone.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return last ? (last.workoutDay + 1) % count : 0;
}

export function CheckRow({
  label,
  done,
  onToggle,
  disabled,
}: {
  label: string;
  done: boolean;
  onToggle?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors",
          done ? "border-success bg-success text-success-foreground" : "border-border",
        )}
        aria-hidden
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : null}
      </span>
      <span
        className={cn("min-w-0 flex-1 text-left", done && "text-muted-foreground line-through")}
      >
        {label}
      </span>
    </>
  );
  if (!onToggle) return <li className="flex items-center gap-3 px-4 py-3 text-sm">{body}</li>;
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        disabled={disabled}
        onClick={onToggle}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-accent/60 disabled:opacity-60"
      >
        {body}
      </button>
    </li>
  );
}

export function PlanHeading({
  kind,
  name,
  sub,
}: {
  kind: "workout" | "diet";
  name: string;
  sub: string;
}) {
  const Icon = kind === "workout" ? Dumbbell : Salad;
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-eyebrow">{kind === "workout" ? "Workout plan" : "Diet plan"}</p>
        <h2 className="text-card-title truncate">{name}</h2>
        <p className="text-meta">{sub}</p>
      </div>
    </div>
  );
}

/** Read-only view of a plan's content (trainer app, staff profile). */
export function PlanContent({
  workout,
  diet,
}: {
  workout?: PortalWorkout | null;
  diet?: PortalDiet | null;
}) {
  if (workout)
    return (
      <div className="space-y-3">
        {workout.description ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{workout.description}</p>
        ) : null}
        {workout.days.length ? (
          workout.days.map((d, i) => (
            <div key={i} className="rounded-xl border border-border">
              <p className="border-b border-border px-4 py-2 text-sm font-bold">
                {d.title || `Day ${i + 1}`}
              </p>
              <ol className="list-decimal space-y-1 px-8 py-2 text-sm">
                {planLines(d.exercises).map((x, j) => (
                  <li key={j}>{x}</li>
                ))}
              </ol>
            </div>
          ))
        ) : (
          <p className="text-meta">No exercises listed in this plan.</p>
        )}
        {workout.notes ? <p className="text-sm">Note: {workout.notes}</p> : null}
      </div>
    );
  if (diet)
    return (
      <div className="space-y-3">
        {diet.description ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{diet.description}</p>
        ) : null}
        <ol className="list-decimal space-y-1 rounded-xl border border-border px-8 py-3 text-sm">
          {mealItems(diet).map((x, j) => (
            <li key={j}>{x}</li>
          ))}
        </ol>
        {diet.notes ? <p className="text-sm">Note: {diet.notes}</p> : null}
      </div>
    );
  return null;
}

/** Last `days` days: did the workout (✓) and how many meals were ticked. */
export function WeekStrip({
  logs,
  today,
  end = today,
  workout,
  diet,
  days = 7,
}: {
  logs: PortalLog[];
  today: string;
  /** Last day shown (default today). */
  end?: string;
  workout: PortalWorkout | null;
  diet: PortalDiet | null;
  days?: number;
}) {
  const dates = Array.from({ length: days }, (_, i) => shiftDate(end, i - days + 1));
  const meals = diet ? mealItems(diet).length : 0;
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <ul className="grid grid-cols-7 gap-1.5" aria-label={`Last ${days} days`}>
      {dates.map((d) => {
        const log = logs.find((l) => l.date === d);
        const trained = !!log?.workoutDone.length;
        const ate = log?.dietDone.length ?? 0;
        return (
          <li
            key={d}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border border-border py-2 text-[11px]",
              d === today && "ring-2 ring-primary",
            )}
            title={d}
          >
            <span className="font-semibold text-muted-foreground">
              {DAY[new Date(`${d}T00:00:00Z`).getUTCDay()]}
            </span>
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full",
                trained ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
              )}
              aria-label={trained ? "Workout done" : "No workout"}
            >
              {workout ? (
                trained ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  <Dumbbell className="size-3" />
                )
              ) : (
                "–"
              )}
            </span>
            {diet ? (
              <span
                className={cn(
                  "tabular-nums",
                  ate ? "font-bold text-success" : "text-muted-foreground",
                )}
              >
                <Salad className="-mt-0.5 mr-0.5 inline size-3" aria-hidden />
                {ate}/{meals}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
