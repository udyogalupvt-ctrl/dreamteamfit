import { useState } from "react";
import { CalendarClock,MessageCircle,Plus } from "lucide-react";
import { toast } from "sonner";
import { FollowUpDialog } from "@/components/followups/followup-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Shimmer } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO,todayISO } from "@/lib/format";
import { subscribeClientFollowUps } from "@/services/followups.service";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { DEFAULT_WHATSAPP_SETTINGS,subscribeWhatsAppSettings } from "@/services/whatsapp-settings.service";
import type { Client,FollowUp } from "@/types/models";

export function ClientFollowUpsSection({client}:{client:Client}){
  const live=useLive<FollowUp[]>((ok,fail)=>subscribeClientFollowUps(client.id,ok,fail),[],[client.id]);
  const settings=useLive(subscribeWhatsAppSettings,DEFAULT_WHATSAPP_SETTINGS,[]);
  const [open,setOpen]=useState(false),today=todayISO();
  const send=async(item:FollowUp)=>{try{const result=await sendWhatsAppMessage({client,type:"follow_up",referenceId:item.id,templateName:settings.data.followUpTemplate,templateLanguage:settings.data.templateLanguage,parameters:[client.fullName,item.reason,item.followUpDate],messagePreview:`Follow-up: ${item.reason} on ${formatDateISO(item.followUpDate)}`,provider:settings.data.mode});toast.success(result.duplicate?"Follow-up message already queued":settings.data.mode==="mock"?"Follow-up queued in Mock mode":"Follow-up sent to WhatsApp")}catch(error){toast.error(error instanceof Error?error.message:"Couldn't send follow-up")}};
  if(live.loading)return <Shimmer className="h-40 rounded-xl"/>;if(live.error)return <ErrorState error={live.error} title="Couldn't load follow-ups"/>;
  const groups=[["Overdue",live.data.filter(x=>x.status==="pending"&&x.followUpDate<today)],["Upcoming",live.data.filter(x=>x.status==="pending"&&x.followUpDate>=today)],["Past",live.data.filter(x=>x.status!=="pending")]] as const;
  return <div className="space-y-4"><div className="flex justify-end"><Button onClick={()=>setOpen(true)}><Plus/> Create Follow-up</Button></div>{live.data.length===0?<EmptyState icon={CalendarClock} title="No follow-ups yet" description="Schedule the next conversation with this client."/>:groups.map(([title,items])=>items.length?<section className="surface-card p-5" key={title}><h2 className="text-section-title">{title} Follow-ups</h2><div className="mt-3 divide-y divide-border">{items.map(x=><article key={x.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-semibold">{formatDateISO(x.followUpDate)} · {x.followUpTime}</p><p className="text-meta">{x.outcome||x.reason} · {x.notes||"No notes"}</p><p className="text-meta">{x.nextAction||"No next action"} · {x.assignedTo||"Unassigned"}</p></div><div className="flex items-center gap-2"><StatusPill tone={x.status==="completed"?"success":x.followUpDate<today?"danger":"warning"}>{x.status==="pending"&&x.followUpDate<today?"overdue":x.status}</StatusPill>{x.status==="pending"?<Button size="sm" variant="outline" onClick={()=>void send(x)}><MessageCircle/> WhatsApp</Button>:null}</div></article>)}</div></section>:null)}<FollowUpDialog open={open} onOpenChange={setOpen} clients={[client]} initialClient={client}/></div>;
}