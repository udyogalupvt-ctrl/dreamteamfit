import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Salad, MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { DietPlanFormDialog } from "@/components/plans/diet-plan-form-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLive } from "@/hooks/use-live-query";
import { formatDate } from "@/lib/format";
import { deleteDietPlan, subscribeDietPlans, updateDietPlan } from "@/services/diet-plans.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { DietPlan } from "@/types/models";

export const Route = createFileRoute("/_authenticated/diet-plans")({
 validateSearch: z.object({ create: z.boolean().optional() }),
 head: () => ({ meta: [{ title: "Diet Plans — REBUILD FITNESS" },{ name: "description", content: "Create and manage diet plans for members." },{ property: "og:title", content: "Diet Plans — REBUILD FITNESS" },{ property: "og:description", content: "Create and manage diet plans for members." },{ property: "og:type", content: "website" },{ name: "twitter:card", content: "summary" }] }),
 component: Page,
});
type Filter="all"|"active"|"inactive";
function Page(){
 const {create}=Route.useSearch(); const {data,loading,error}=useLive<DietPlan[]>(subscribeDietPlans,[],[]); const [search,setSearch]=useState("");const [status,setStatus]=useState<Filter>("all");const [open,setOpen]=useState(Boolean(create));const [editing,setEditing]=useState<DietPlan|null>(null);const [viewing,setViewing]=useState<DietPlan|null>(null);const [deleting,setDeleting]=useState<DietPlan|null>(null);
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return data.filter(p=>(status==="all"||(status==="active"?p.isActive:!p.isActive))&&(!q||p.name.toLowerCase().includes(q)||p.goal.toLowerCase().includes(q)||p.description.toLowerCase().includes(q)));},[data,search,status]);
 const edit=(p:DietPlan)=>{setEditing(p);setOpen(true)}; const toggle=async(p:DietPlan)=>{try{await updateDietPlan(p.id,{isActive:!p.isActive});toast.success(p.isActive?"Diet plan deactivated":"Diet plan activated");}catch(e){toast.error(firestoreErrorMessage(e));}};
 const remove=async()=>{if(!deleting)return;const p=deleting;setDeleting(null);try{await deleteDietPlan(p.id);toast.success("Diet plan deleted");if(viewing?.id===p.id)setViewing(null);}catch(e){toast.error(firestoreErrorMessage(e));}};
 return <div className="space-y-6"><PageHeader title="Diet Plans" description="Reusable diet plans your staff can assign to clients." breadcrumbs={[{label:"Home",to:"/dashboard"},{label:"Diet Plans"}]} actions={<Button onClick={()=>{setEditing(null);setOpen(true)}}><Plus/> New plan</Button>}/>
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><SearchInput value={search} onValueChange={setSearch} placeholder="Search diet plans…" label="Search diet plans" containerClassName="sm:max-w-sm"/><Tabs value={status} onValueChange={v=>setStatus(v as Filter)}><TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="inactive">Inactive</TabsTrigger></TabsList></Tabs></div>
 {loading?<LoadingRows rows={4}/>:error?<ErrorState error={error} title="Couldn't load diet plans"/>:data.length===0?<EmptyState icon={Salad} title="No diet plans yet" description="Create a nutrition plan to assign it to members." action={<Button onClick={()=>setOpen(true)}><Plus/> Create plan</Button>}/>:filtered.length===0?<EmptyState icon={Salad} title="No matching plans" description="Try a different search or filter."/>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(p=><article key={p.id} className="surface-card flex min-w-0 flex-col p-5"><div className="flex items-start justify-between gap-3"><button type="button" onClick={()=>setViewing(p)} className="min-w-0 cursor-pointer text-left"><h2 className="text-card-title truncate">{p.name}</h2><p className="text-meta mt-0.5">{p.goal}</p></button><Actions p={p} onView={()=>setViewing(p)} onEdit={()=>edit(p)} onToggle={()=>void toggle(p)} onDelete={()=>setDeleting(p)}/></div><p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.description||"No description"}</p><div className="mt-4 flex items-end justify-between gap-3"><div><p className="font-display text-xl font-extrabold tabular-nums">{p.dailyCalories}</p><p className="text-meta">kcal / day</p></div><StatusPill tone={p.isActive?"success":"warning"}>{p.isActive?"Active":"Inactive"}</StatusPill></div></article>)}</div>}
 <DietPlanFormDialog open={open} onOpenChange={setOpen} plan={editing}/>
 <Sheet open={!!viewing} onOpenChange={o=>!o&&setViewing(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-md">{viewing?<><SheetHeader className="text-left"><SheetTitle>{viewing.name}</SheetTitle><SheetDescription>{viewing.description||"No description"}</SheetDescription></SheetHeader><dl className="mt-6 grid grid-cols-2 gap-3 px-4">{[["Goal",viewing.goal],["Kcal / Day",String(viewing.dailyCalories)],["Status",viewing.isActive?"Active":"Inactive"],["Created",formatDate(viewing.createdAt)]].map(([k,v])=><div key={k} className="rounded-xl border border-border bg-muted/40 p-3"><dt className="text-meta">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl><div className="mt-6 flex flex-wrap gap-2 px-4"><Button onClick={()=>edit(viewing)}><Pencil/> Edit</Button><Button variant="outline" onClick={()=>void toggle(viewing).then(()=>setViewing(null))}><Power/> {viewing.isActive?"Deactivate":"Activate"}</Button></div></>:null}</SheetContent></Sheet>
 <ConfirmDialog open={!!deleting} onOpenChange={o=>!o&&setDeleting(null)} title={`Delete ${deleting?.name??"plan"}?`} description="This permanently removes the plan. Plans with assignment history cannot be deleted — deactivate them instead." confirmLabel="Delete plan" destructive onConfirm={()=>void remove()}/></div>;
}
function Actions({p,onView,onEdit,onToggle,onDelete}:{p:DietPlan;onView:()=>void;onEdit:()=>void;onToggle:()=>void;onDelete:()=>void}){return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={onView}><Salad/> View details</DropdownMenuItem><DropdownMenuItem onSelect={onEdit}><Pencil/> Edit</DropdownMenuItem><DropdownMenuItem onSelect={onToggle}><Power/> {p.isActive?"Deactivate":"Activate"}</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2/> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
