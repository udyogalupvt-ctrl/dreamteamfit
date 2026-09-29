import { useEffect, useState } from "react";
import { Dumbbell, Plus, Salad, XCircle } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Shimmer } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { PlanContent, WeekStrip } from "@/components/portal/plan-view";
import { Button } from "@/components/ui/button";
import {
  indiaToday,
  shiftDate,
  type PortalDiet,
  type PortalLog,
  type PortalWorkout,
} from "@/constants/portal";
import { useLive } from "@/hooks/use-live-query";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "@/lib/firestore";
import { ASSIGNMENT_STATUS_META, formatDateISO } from "@/lib/format";
import { subscribeDietPlans } from "@/services/diet-plans.service";
import { subscribeWorkoutPlans } from "@/services/workout-plans.service";
import type { DietAssignment, DietPlan, WorkoutAssignment, WorkoutPlan } from "@/types/models";

type Props =
  | {
      kind: "workout";
      clientId: string;
      items: WorkoutAssignment[];
      loading: boolean;
      error: Error | null;
      onAdd: () => void;
      onClose: (item: WorkoutAssignment) => void;
    }
  | {
      kind: "diet";
      clientId: string;
      items: DietAssignment[];
      loading: boolean;
      error: Error | null;
      onAdd: () => void;
      onClose: (item: DietAssignment) => void;
    };

/** The member's ticks in the member app for the last 7 days. */
function useRecentLogs(clientId: string) {
  const [logs, setLogs] = useState<PortalLog[]>([]);
  useEffect(() => {
    const today = indiaToday();
    void Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        getDoc(doc(db, "planLogs", `${clientId}_${shiftDate(today, -i)}`)).catch(() => null),
      ),
    ).then((snaps) =>
      setLogs(
        snaps.flatMap((s) => {
          const d = s?.data();
          if (!d) return [];
          const nums = (x: unknown) => (Array.isArray(x) ? x.map(Number) : []);
          return [
            {
              date: String(d["date"] ?? ""),
              workoutDay: Number(d["workoutDay"] ?? 0),
              workoutDone: nums(d["workoutDone"]),
              dietDone: nums(d["dietDone"]),
            },
          ];
        }),
      ),
    );
  }, [clientId]);
  return logs;
}

const toWorkout = (a: WorkoutAssignment, plans: WorkoutPlan[]): PortalWorkout => {
  const tpl = plans.find((p) => p.id === a.workoutPlanId);
  return {
    assignmentId: a.id,
    name: a.planNameSnapshot,
    goal: a.goalSnapshot,
    description: a.custom ? a.description : (tpl?.description ?? ""),
    notes: a.notes,
    startDate: a.startDate,
    endDate: a.endDate,
    days: a.custom ? a.days : (tpl?.days ?? []),
    by: a.assignedByName || "Gym",
    custom: a.custom,
  };
};
const toDiet = (a: DietAssignment, plans: DietPlan[]): PortalDiet => {
  const tpl = plans.find((p) => p.id === a.dietPlanId);
  return {
    assignmentId: a.id,
    name: a.planNameSnapshot,
    goal: a.goalSnapshot,
    calories: a.dailyCaloriesSnapshot,
    description: a.custom ? a.description : (tpl?.description ?? ""),
    notes: a.notes,
    meals: a.custom ? a.mealStructure : (tpl?.mealStructure ?? ""),
    startDate: a.startDate,
    endDate: a.endDate,
    by: a.assignedByName || "Gym",
    custom: a.custom,
  };
};

export function AssignmentSection(props: Props) {
  const isWorkout = props.kind === "workout";
  const Icon = isWorkout ? Dumbbell : Salad;
  const workoutPlans = useLive<WorkoutPlan[]>(
    isWorkout ? subscribeWorkoutPlans : null,
    [],
    [isWorkout],
  );
  const dietPlans = useLive<DietPlan[]>(isWorkout ? null : subscribeDietPlans, [], [isWorkout]);
  const logs = useRecentLogs(props.clientId);
  const current = props.items.find((i) => i.status === "active") ?? null;

  if (props.loading) return <Shimmer className="h-40 w-full rounded-2xl" />;
  if (props.error)
    return <ErrorState error={props.error} title={`Couldn't load ${props.kind} assignments`} />;
  if (!props.items.length)
    return (
      <EmptyState
        icon={Icon}
        title={`No ${props.kind} plan assigned`}
        description={`Assign a ${props.kind} plan: the member sees it in their member app and ticks it every day.`}
        action={
          <Button onClick={props.onAdd}>
            <Plus /> Assign {props.kind} plan
          </Button>
        }
      />
    );

  const workout =
    current && props.kind === "workout"
      ? toWorkout(current as WorkoutAssignment, workoutPlans.data)
      : null;
  const diet =
    current && props.kind === "diet" ? toDiet(current as DietAssignment, dietPlans.data) : null;

  return (
    <div className="space-y-4">
      {current ? (
        <section className="surface-card relative overflow-hidden p-5">
          <span className="absolute inset-x-0 top-0 h-0.5 bg-success" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-eyebrow">Current {props.kind} plan</p>
              <h2 className="text-section-title mt-1 truncate">{current.planNameSnapshot}</h2>
              <p className="text-meta">
                {current.goalSnapshot} · {formatDateISO(current.startDate)} →{" "}
                {formatDateISO(current.endDate)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusPill tone={current.custom ? "violet" : "info"}>
                  {current.custom ? "Personal plan" : "Gym plan"}
                </StatusPill>
                {current.assignedByName ? (
                  <StatusPill tone="primary">By {current.assignedByName}</StatusPill>
                ) : null}
              </div>
              {!isWorkout ? (
                <p className="mt-2 font-semibold tabular-nums">
                  {(current as DietAssignment).dailyCaloriesSnapshot} kcal / day
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={props.onAdd}>
                <Plus /> New plan
              </Button>
              <Button variant="ghost" onClick={() => props.onClose(current as never)}>
                <XCircle /> Cancel
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <PlanContent workout={workout} diet={diet} />
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <p className="text-label">Ticked in the member app (last 7 days)</p>
            <WeekStrip
              logs={logs}
              today={indiaToday()}
              workout={isWorkout ? workout : null}
              diet={isWorkout ? null : diet}
            />
          </div>
        </section>
      ) : (
        <div className="flex justify-end">
          <Button onClick={props.onAdd}>
            <Plus /> Assign {props.kind} plan
          </Button>
        </div>
      )}
      <section className="surface-card overflow-hidden">
        <h2 className="text-section-title border-b border-border p-5">
          {isWorkout ? "Workout" : "Diet"} history
        </h2>
        <ul className="divide-y divide-border">
          {props.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{item.planNameSnapshot}</p>
                <p className="text-meta">
                  {item.goalSnapshot} · {formatDateISO(item.startDate)} →{" "}
                  {formatDateISO(item.endDate)}
                  {item.assignedByName ? ` · by ${item.assignedByName}` : ""}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                {!isWorkout ? (
                  <span className="text-sm font-semibold tabular-nums">
                    {(item as DietAssignment).dailyCaloriesSnapshot} kcal
                  </span>
                ) : null}
                <StatusPill tone={ASSIGNMENT_STATUS_META[item.status].tone}>
                  {ASSIGNMENT_STATUS_META[item.status].label}
                </StatusPill>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
