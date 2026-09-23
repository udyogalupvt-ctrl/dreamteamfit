import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { workoutPlanSchema } from "@/lib/plan-validation";
import { createWorkoutPlan, updateWorkoutPlan } from "@/services/workout-plans.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { WORKOUT_GOALS, type WorkoutPlan } from "@/types/models";

type Errors = Partial<Record<"name" | "goal" | "description" | "durationWeeks" | "daysPerWeek" | "isActive", string>>;
export function WorkoutPlanFormDialog({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (v: boolean) => void; plan?: WorkoutPlan | null }) {
  const [name,setName]=useState(""); const [goal,setGoal]=useState<(typeof WORKOUT_GOALS)[number]>("General Fitness"); const [description,setDescription]=useState(""); const [weeks,setWeeks]=useState(""); const [days,setDays]=useState(""); const [active,setActive]=useState(true); const [errors,setErrors]=useState<Errors>({}); const [saving,setSaving]=useState(false);
  useEffect(()=>{if(open){setName(plan?.name??"");setGoal(plan?.goal??"General Fitness");setDescription(plan?.description??"");setWeeks(plan?String(plan.durationWeeks):"");setDays(plan?String(plan.daysPerWeek):"");setActive(plan?.isActive??true);setErrors({});}},[open,plan]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();const parsed=workoutPlanSchema.safeParse({name,goal,description,durationWeeks:weeks.trim()?Number(weeks):0,daysPerWeek:days.trim()?Number(days):0,isActive:active});if(!parsed.success){const next:Errors={};parsed.error.issues.forEach(i=>{const key=i.path[0] as keyof Errors;if(!next[key])next[key]=i.message});setErrors(next);return;}setSaving(true);try{if(plan)await updateWorkoutPlan(plan.id,parsed.data);else await createWorkoutPlan(parsed.data);toast.success(plan?"Workout plan updated":"Workout plan created",{description:parsed.data.name});onOpenChange(false);}catch(err){toast.error(firestoreErrorMessage(err));}finally{setSaving(false)}};
  return <FormDialog open={open} onOpenChange={onOpenChange} title={plan?"Edit workout plan":"Create workout plan"} description="Define a reusable training program for your members." footer={<><Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button><Button type="submit" form="workout-plan-form" disabled={saving}>{saving?<Loader2 className="animate-spin"/>:null}{plan?"Save changes":"Create plan"}</Button></>}>
    <form id="workout-plan-form" onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Plan name" htmlFor="wp-name" error={errors.name} required><Input id="wp-name" maxLength={80} value={name} onChange={e=>setName(e.target.value)} aria-invalid={!!errors.name}/></Field>
      <Field label="Goal" htmlFor="wp-goal" error={errors.goal} required><Select value={goal} onValueChange={v=>setGoal(v as typeof goal)}><SelectTrigger id="wp-goal" className="w-full"><SelectValue/></SelectTrigger><SelectContent>{WORKOUT_GOALS.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Description" htmlFor="wp-desc" error={errors.description}><Textarea id="wp-desc" maxLength={1000} rows={4} value={description} onChange={e=>setDescription(e.target.value)}/></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Duration (weeks)" htmlFor="wp-weeks" error={errors.durationWeeks} required><Input id="wp-weeks" type="number" min={1} max={104} inputMode="numeric" value={weeks} onChange={e=>setWeeks(e.target.value)}/></Field><Field label="Days per week" htmlFor="wp-days" error={errors.daysPerWeek} required><Input id="wp-days" type="number" min={1} max={7} inputMode="numeric" value={days} onChange={e=>setDays(e.target.value)}/></Field></div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4"><div><label htmlFor="wp-active" className="text-label">Active</label><p className="text-meta mt-0.5">Only active plans can be assigned.</p></div><Switch id="wp-active" checked={active} onCheckedChange={setActive}/></div>
    </form></FormDialog>;
}
