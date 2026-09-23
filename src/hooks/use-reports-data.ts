import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { useLive } from "@/hooks/use-live-query";
import { effectiveMembershipStatus, todayISO } from "@/lib/format";
import { getReportDateRange, isDateInRange, type ReportDateRange, type ReportPeriod, type ExportableReportSection } from "@/lib/reporting";
import { subscribeBookings } from "@/services/bookings.service";
import { subscribeClassEnrollments } from "@/services/class-enrollments.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribeDietAssignments } from "@/services/diet-assignments.service";
import { subscribeExpenses } from "@/services/expenses.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribeMemberships } from "@/services/memberships.service";
import { subscribeWorkoutAssignments } from "@/services/workout-assignments.service";
import type { Booking, ClassEnrollment, Client, DietAssignment, Expense, ExpenseCategory, Inquiry, Membership, WorkoutAssignment } from "@/types/models";
import { EXPENSE_CATEGORIES, INQUIRY_STATUSES } from "@/types/models";

const dateOf=(value:Date)=>format(value,"yyyy-MM-dd");
export function useReportsData(period:ReportPeriod,custom?:ReportDateRange){
 const clients=useLive<Client[]>(subscribeClients,[],[]),memberships=useLive<Membership[]>(subscribeMemberships,[],[]),inquiries=useLive<Inquiry[]>(subscribeInquiries,[],[]),bookings=useLive<Booking[]>(subscribeBookings,[],[]),enrollments=useLive<ClassEnrollment[]>(subscribeClassEnrollments,[],[]),workouts=useLive<WorkoutAssignment[]>(subscribeWorkoutAssignments,[],[]),diets=useLive<DietAssignment[]>(subscribeDietAssignments,[],[]),expenses=useLive<Expense[]>(subscribeExpenses,[],[]);
 const range=getReportDateRange(period,custom);const result=useMemo(()=>{const inRange=(v:string)=>isDateInRange(v,range);const expenseRows=expenses.data.filter(e=>inRange(e.date));const expenseTotal=expenseRows.reduce((n,e)=>n+e.amount,0);const expenseBreakdown=EXPENSE_CATEGORIES.map(category=>({category,amount:expenseRows.filter(e=>e.category===category).reduce((n,e)=>n+e.amount,0)}));
 const currentMemberships=memberships.data.map(m=>({...m,effective:effectiveMembershipStatus(m)}));const active=currentMemberships.filter(m=>m.effective==="active").length,expired=currentMemberships.filter(m=>m.effective==="expired").length;const today=todayISO(),in7=format(addDays(new Date(),7),"yyyy-MM-dd");const upcoming=currentMemberships.filter(m=>m.effective==="active"&&m.endDate>=today&&m.endDate<=in7).length;
 const rangedInquiries=inquiries.data.filter(i=>inRange(dateOf(i.createdAt)));const inquiryCounts=Object.fromEntries(INQUIRY_STATUSES.map(status=>[status,rangedInquiries.filter(i=>i.status===status).length]));const converted=inquiryCounts["converted"]??0;const conversionRate=rangedInquiries.length?Math.round(converted/rangedInquiries.length*100):null;
 const rangedBookings=bookings.data.filter(b=>inRange(b.date)),rangedEnrollments=enrollments.data.filter(e=>inRange(dateOf(e.enrolledAt))),rangedWorkouts=workouts.data.filter(w=>inRange(w.assignedDate)),rangedDiets=diets.data.filter(d=>inRange(d.assignedDate));
 const sections:ExportableReportSection[]=[
 {id:"expenses",title:"Expense Report",metrics:[{id:"total",label:"Total Expenses",value:String(expenseTotal)}],rows:expenseRows.map(e=>({date:e.date,title:e.title,category:e.category,paymentMethod:e.paymentMethod,amount:e.amount,createdBy:e.createdBy}))},
 {id:"memberships",title:"Membership Report",metrics:[],rows:memberships.data.map(m=>({clientId:m.clientId,package:m.packageNameSnapshot,startDate:m.startDate,endDate:m.endDate,status:effectiveMembershipStatus(m)}))},
 {id:"inquiries",title:"Inquiry Report",metrics:[],rows:rangedInquiries.map(i=>({name:i.name,status:i.status,source:i.source,createdAt:dateOf(i.createdAt)}))},
 {id:"bookings",title:"Booking Report",metrics:[],rows:rangedBookings.map(b=>({date:b.date,type:b.bookingType,client:b.clientNameSnapshot,status:b.status}))},
 {id:"workout-diet",title:"Workout & Diet Report",metrics:[],rows:[...rangedWorkouts.map(w=>({type:"Workout",plan:w.planNameSnapshot,status:w.status,assignedDate:w.assignedDate})),...rangedDiets.map(d=>({type:"Diet",plan:d.planNameSnapshot,status:d.status,assignedDate:d.assignedDate}))]},
 ];
 return {range,expenseRows,expenseTotal,expenseBreakdown,clients:{total:clients.data.length,active,expired,newClients:clients.data.filter(c=>inRange(dateOf(c.createdAt))).length,newMemberships:memberships.data.filter(m=>inRange(dateOf(m.createdAt))).length,upcoming},inquiries:{total:rangedInquiries.length,counts:inquiryCounts,conversionRate},bookings:{total:rangedBookings.length,pt:rangedBookings.filter(b=>b.bookingType==="pt").length,group:rangedEnrollments.length,completed:rangedBookings.filter(b=>b.status==="completed").length,cancelled:rangedBookings.filter(b=>b.status==="cancelled").length,noShow:rangedBookings.filter(b=>b.status==="no_show").length},plans:{activeWorkouts:workouts.data.filter(w=>w.status==="active").length,activeDiets:diets.data.filter(d=>d.status==="active").length,workoutAssignments:rangedWorkouts.length,dietAssignments:rangedDiets.length},sections};},[range.start,range.end,clients.data,memberships.data,inquiries.data,bookings.data,enrollments.data,workouts.data,diets.data,expenses.data]);
 return {...result,loading:[clients,memberships,inquiries,bookings,enrollments,workouts,diets,expenses].some(x=>x.loading),error:[clients,memberships,inquiries,bookings,enrollments,workouts,diets,expenses].find(x=>x.error)?.error??null};
}
