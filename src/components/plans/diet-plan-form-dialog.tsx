import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dietPlanSchema } from "@/lib/plan-validation";
import { createDietPlan, updateDietPlan } from "@/services/diet-plans.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { DIET_GOALS, type DietPlan } from "@/types/models";

type Errors=Partial<Record<"name"|"goal"|"description"|"dailyCalories"|"mealStructure"|"notes"|"isActive",string>>;
export function DietPlanFormDialog({open,onOpenChange,plan}:{open:boolean;onOpenChange:(v:boolean)=>void;plan?:DietPlan|null}){
 const [name,setName]=useState("");const [goal,setGoal]=useState<(typeof DIET_GOALS)[number]>("General Fitness");const [description,setDescription]=useState("");const [calories,setCalories]=useState("");const [meals,setMeals]=useState("");const [notes,setNotes]=useState("");const [active,setActive]=useState(true);const [errors,setErrors]=useState<Errors>({});const [saving,setSaving]=useState(false);
 useEffect(()=>{if(open){setName(plan?.name??"");setGoal(plan?.goal??"General Fitness");setDescription(plan?.description??"");setCalories(plan?String(plan.dailyCalories):"");setMeals(plan?.mealStructure??"");setNotes(plan?.notes??"");setActive(plan?.isActive??true);setErrors({});}},[open,plan]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();const parsed=dietPlanSchema.safeParse({name,goal,description,dailyCalories:calories.trim()?Number(calories):Number.NaN,mealStructure:meals,notes,isActive:active});if(!parsed.success){const next:Errors={};parsed.error.issues.forEach(i=>{const key=i.path[0] as keyof Errors;if(!next[key])next[key]=i.message});setErrors(next);return;}setSaving(true);try{if(plan)await updateDietPlan(plan.id,parsed.data);else await createDietPlan(parsed.data);toast.success(plan?"Diet plan updated":"Diet plan created",{description:parsed.data.name});onOpenChange(false);}catch(err){toast.error(firestoreErrorMessage(err));}finally{setSaving(false)}};
 return <FormDialog open={open} onOpenChange={onOpenChange} title={plan?"Edit diet plan":"Create diet plan"} description="Define a reusable nutrition plan for your members." footer={<><Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button><Button type="submit" form="diet-plan-form" disabled={saving}>{saving?<Loader2 className="animate-spin"/>:null}{plan?"Save changes":"Create plan"}</Button></>}><form id="diet-plan-form" onSubmit={submit} className="grid gap-4" noValidate>
 <Field label="Plan name" htmlFor="dp-name" error={errors.name} required><Input id="dp-name" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></Field>
 <Field label="Goal" htmlFor="dp-goal" error={errors.goal} required><Select value={goal} onValueChange={v=>setGoal(v as typeof goal)}><SelectTrigger id="dp-goal" className="w-full"><SelectValue/></SelectTrigger><SelectContent>{DIET_GOALS.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
 <Field label="Description" htmlFor="dp-desc" error={errors.description}><Textarea id="dp-desc" maxLength={1000} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/></Field>
 <Field label="Daily calories" htmlFor="dp-cal" error={errors.dailyCalories} required><Input id="dp-cal" type="number" min={0} max={20000} inputMode="numeric" value={calories} onChange={e=>setCalories(e.target.value)}/></Field>
 <Field label="Meal structure" htmlFor="dp-meals" error={errors.mealStructure}><Textarea id="dp-meals" maxLength={3000} rows={5} value={meals} onChange={e=>setMeals(e.target.value)} placeholder="Breakfast, lunch, dinner and snacks"/></Field>
 <Field label="Notes" htmlFor="dp-notes" error={errors.notes}><Textarea id="dp-notes" maxLength={1500} rows={3} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
 <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4"><div><label htmlFor="dp-active" className="text-label">Active</label><p className="text-meta mt-0.5">Only active plans can be assigned.</p></div><Switch id="dp-active" checked={active} onCheckedChange={setActive}/></div>
 </form></FormDialog>;
}
