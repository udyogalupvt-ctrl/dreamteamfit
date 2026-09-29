import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_WORKOUT_DAYS, PLAN_TEXT_MAX, planLines } from "@/constants/portal";
import type { WorkoutDay } from "@/types/models";

/** Day 1, Day 2…: a name and the exercises, one per line. Members tick each line in their app. */
export function WorkoutDaysEditor({
  days,
  onChange,
  idPrefix,
}: {
  days: WorkoutDay[];
  onChange: (days: WorkoutDay[]) => void;
  idPrefix: string;
}) {
  const set = (i: number, patch: Partial<WorkoutDay>) =>
    onChange(days.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <fieldset className="grid gap-3">
      <legend className="text-label mb-1">Workout days</legend>
      <p className="text-meta -mt-1">
        One exercise per line, e.g. “Bench press 3 × 10”. Members tick each one in their app.
      </p>
      {days.map((d, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-border p-3">
          <div className="flex items-center gap-2">
            <label htmlFor={`${idPrefix}-t${i}`} className="sr-only">
              Day {i + 1} name
            </label>
            <Input
              id={`${idPrefix}-t${i}`}
              value={d.title}
              maxLength={60}
              placeholder={`Day ${i + 1} (e.g. Chest & triceps)`}
              onChange={(e) => set(i, { title: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove day ${i + 1}`}
              onClick={() => onChange(days.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
          <label htmlFor={`${idPrefix}-x${i}`} className="sr-only">
            Day {i + 1} exercises
          </label>
          <Textarea
            id={`${idPrefix}-x${i}`}
            rows={5}
            maxLength={PLAN_TEXT_MAX}
            value={d.exercises}
            placeholder={
              "Bench press 3 × 10\nIncline dumbbell press 3 × 12\nTriceps pushdown 3 × 15"
            }
            onChange={(e) => set(i, { exercises: e.target.value })}
          />
          <p className="text-meta">{planLines(d.exercises).length} exercises</p>
        </div>
      ))}
      {days.length < MAX_WORKOUT_DAYS ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...days, { title: `Day ${days.length + 1}`, exercises: "" }])}
        >
          <Plus aria-hidden /> Add day
        </Button>
      ) : null}
    </fieldset>
  );
}

/** Days with something in them, titles filled in. */
export const cleanWorkoutDays = (days: WorkoutDay[]) =>
  days
    .filter((d) => d.title.trim() || planLines(d.exercises).length)
    .map((d, i) => ({ title: d.title.trim() || `Day ${i + 1}`, exercises: d.exercises.trim() }));
