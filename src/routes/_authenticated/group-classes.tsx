import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { ClassDetailsSheet } from "@/components/scheduling/class-details-sheet";
import { GroupClassFormDialog } from "@/components/scheduling/group-class-form-dialog";
import { ClassCard } from "@/components/scheduling/schedule-card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeGroupClasses,updateGroupClassStatus } from "@/services/group-classes.service";
import type { GroupClass } from "@/types/models";
export const Route=createFileRoute("/_authenticated/group-classes")({head:()=>({meta:[{title:"Group Classes — REBUILD FITNESS"},{name:"description",content:"Schedule classes and manage member enrollment capacity."},{property:"og:title",content:"Group Classes — REBUILD FITNESS"},{property:"og:description",content:"Schedule classes and manage member enrollment capacity."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}]}),component:Page});
function Page(){const live=useLive<GroupClass[]>(subscribeGroupClasses,[],[]);const [form,setForm]=useState(false);const [editing,setEditing]=useState<GroupClass|null>(null);const [viewing,setViewing]=useState<GroupClass|null>(null);const edit=(g:GroupClass)=>{setViewing(null);setEditing(g);setForm(true)};const cancel=async(g:GroupClass)=>{try{await updateGroupClassStatus(g.id,"cancelled");setViewing(null);toast.success("Class cancelled")}catch(e){toast.error(firestoreErrorMessage(e))}};return <div className="space-y-6"><PageHeader title="Group Classes" description="Live class schedules, capacity, and member enrollment." breadcrumbs={[{label:"Home",to:"/dashboard"},{label:"Group Classes"}]} actions={<Button onClick={()=>{setEditing(null);setForm(true)}}><Plus/> Create Class</Button>}/>{live.loading?<LoadingRows rows={6}/>:live.error?<ErrorState error={live.error} title="Couldn't load group classes"/>:live.data.length===0?<EmptyState icon={UsersRound} title="No group classes yet" description="Create a class to schedule a trainer and enroll members." action={<Button onClick={()=>setForm(true)}><Plus/> Create Class</Button>}/>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{live.data.map(g=><ClassCard key={g.id} item={g} onOpen={()=>setViewing(g)}/>)}</div>}<GroupClassFormDialog open={form} onOpenChange={setForm} item={editing}/><ClassDetailsSheet item={viewing} open={!!viewing} onOpenChange={o=>!o&&setViewing(null)} onEdit={edit} onCancel={g=>void cancel(g)}/></div>}
