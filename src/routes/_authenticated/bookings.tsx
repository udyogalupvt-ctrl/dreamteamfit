import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarDays, List, Plus } from "lucide-react";
import { z } from "zod";
import { BookingFormDialog } from "@/components/scheduling/booking-form-dialog";
import { BookingCard } from "@/components/scheduling/schedule-card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLive } from "@/hooks/use-live-query";
import { todayISO } from "@/lib/format";
import { subscribeBookings } from "@/services/bookings.service";
import type { Booking } from "@/types/models";
export const Route=createFileRoute("/_authenticated/bookings")({validateSearch:z.object({create:z.boolean().optional()}),head:()=>({meta:[{title:"Bookings — REBUILD FITNESS"},{name:"description",content:"Manage the gym schedule, PT bookings, and member appointments."},{property:"og:title",content:"Bookings — REBUILD FITNESS"},{property:"og:description",content:"Manage the gym schedule, PT bookings, and member appointments."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}]}),component:Page});
type View="today"|"upcoming"|"calendar"|"list";
function Page(){const {create}=Route.useSearch();const live=useLive<Booking[]>(subscribeBookings,[],[]);const [view,setView]=useState<View>("today");const [selected,setSelected]=useState<Date>(new Date());const [open,setOpen]=useState(Boolean(create));const [editing,setEditing]=useState<Booking|null>(null);const today=todayISO();const selectedISO=format(selected,"yyyy-MM-dd");const items=useMemo(()=>live.data.filter(b=>view==="today"?b.date===today:view==="upcoming"?b.date>=today:view==="calendar"?b.date===selectedISO:true),[live.data,view,today,selectedISO]);const dates=useMemo(()=>live.data.filter(b=>b.status==="scheduled").map(b=>new Date(`${b.date}T12:00:00`)),[live.data]);return <div className="space-y-6"><PageHeader title="Bookings" description="Your live PT, class, and member schedule." breadcrumbs={[{label:"Home",to:"/dashboard"},{label:"Bookings"}]} actions={<Button onClick={()=>{setEditing(null);setOpen(true)}}><Plus/> New Booking</Button>}/><Tabs value={view} onValueChange={v=>setView(v as View)}><TabsList className="w-full overflow-x-auto sm:w-auto"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="calendar">Calendar</TabsTrigger><TabsTrigger value="list">List</TabsTrigger></TabsList></Tabs>{view==="calendar"?<div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]"><section className="surface-card h-fit overflow-x-auto p-3"><Calendar mode="single" selected={selected} onSelect={d=>d&&setSelected(d)} modifiers={{booked:dates}} modifiersClassNames={{booked:"after:content-[''] after:size-1 after:rounded-full after:bg-primary"}} className="mx-auto"/></section><Agenda items={items} loading={live.loading} error={live.error} onEdit={b=>{setEditing(b);setOpen(true)}}/></div>:<Agenda items={items} loading={live.loading} error={live.error} onEdit={b=>{setEditing(b);setOpen(true)}}/>}<BookingFormDialog open={open} onOpenChange={setOpen} booking={editing}/></div>}
function Agenda({items,loading,error,onEdit}:{items:Booking[];loading:boolean;error:Error|null;onEdit:(b:Booking)=>void}){if(loading)return <LoadingRows rows={5}/>;if(error)return <ErrorState error={error} title="Couldn't load bookings"/>;if(!items.length)return <EmptyState icon={CalendarDays} title="No bookings today" description="Create a booking to add it to the live schedule."/>;const grouped=Object.entries(items.reduce<Record<string,Booking[]>>((a,b)=>{(a[b.date]??=[]).push(b);return a},{}));return <div className="space-y-5">{grouped.map(([date,rows])=><section key={date}><h2 className="text-section-title mb-3">{format(new Date(`${date}T12:00:00`),"EEEE, d MMMM")}</h2><div className="grid gap-3">{rows.map(item=><BookingCard key={item.id} item={item} onEdit={onEdit}/>)}</div></section>)}</div>}
