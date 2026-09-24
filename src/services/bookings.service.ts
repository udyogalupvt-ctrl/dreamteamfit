import { addDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, where, type DocumentData } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { bookingSchema } from "@/lib/scheduling-validation";
import type { Booking, BookingStatus } from "@/types/models";
import { mapPtAssignment } from "./pt.service";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export type BookingInput = Omit<Booking, "id" | "createdAt" | "updatedAt" | "ptAssignmentId" | "ptPackageId" | "ptPackageNameSnapshot" | "assignedTrainerId" | "assignedTrainerNameSnapshot" | "trainerOverride" | "dateOverride"> & Partial<Pick<Booking, "ptAssignmentId" | "ptPackageId" | "ptPackageNameSnapshot" | "assignedTrainerId" | "assignedTrainerNameSnapshot" | "trainerOverride" | "dateOverride">>;
export const mapBookingDoc = (id: string, d: DocumentData) => mapBooking(id, d);
export const subscribeTrainerBookings = (trainerId:string,ok:(v:Booking[])=>void,fail:(e:Error)=>void)=>subscribeQuery(query(col(COLLECTIONS.bookings),where("trainerId","==",trainerId)),mapBooking,(v)=>ok(sort(v)),fail);
/** Throws a clear message when the PT assignment cannot back a scheduled session on this date. */
export async function assertPtAssignmentValid(input:{ptAssignmentId:string;clientId:string;date:string;dateOverride:boolean;status:string}){
 if(!input.ptAssignmentId)throw new Error("No active PT package for this client.");
 const snap=await getDoc(doc(db,COLLECTIONS.ptAssignments,input.ptAssignmentId));
 if(!snap.exists())throw new Error("No active PT package for this client.");
 const a=mapPtAssignment(snap.id,snap.data());
 if(a.clientId!==input.clientId)throw new Error("PT package does not belong to this client.");
 if(input.status!=="scheduled")return a;
 if(a.status==="cancelled")throw new Error("This PT package was cancelled. No active PT package for this client.");
 if(a.status!=="active")throw new Error("No active PT package for this client.");
 if(!input.dateOverride&&(input.date<a.startDate||input.date>a.endDate))throw new Error("Selected date is outside the active PT package period.");
 return a;
}
const mapBooking = (id: string, d: DocumentData): Booking => ({ id, clientId:d["clientId"]??"", clientNameSnapshot:d["clientNameSnapshot"]??"", bookingType:d["bookingType"]??"general", trainerId:d["trainerId"]??"", trainerNameSnapshot:d["trainerNameSnapshot"]??"", groupClassId:d["groupClassId"]??"", date:d["date"]??"", startTime:d["startTime"]??"", endTime:d["endTime"]??"", status:d["status"]??"scheduled", notes:d["notes"]??"", ptAssignmentId:d["ptAssignmentId"]??"", ptPackageId:d["ptPackageId"]??"", ptPackageNameSnapshot:d["ptPackageNameSnapshot"]??"", assignedTrainerId:d["assignedTrainerId"]??d["trainerId"]??"", assignedTrainerNameSnapshot:d["assignedTrainerNameSnapshot"]??d["trainerNameSnapshot"]??"", trainerOverride:Boolean(d["trainerOverride"]), dateOverride:Boolean(d["dateOverride"]), createdAt:toDate(d["createdAt"]), updatedAt:toDate(d["updatedAt"]) });
const sort = (items: Booking[]) => [...items].sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));
export const subscribeBookings = (ok:(v:Booking[])=>void, fail:(e:Error)=>void) => subscribeCollection(COLLECTIONS.bookings,mapBooking,(v)=>ok(sort(v)),fail,orderBy("date","asc"));
export const subscribeClientBookings = (clientId:string,ok:(v:Booking[])=>void,fail:(e:Error)=>void)=>subscribeQuery(query(col(COLLECTIONS.bookings),where("clientId","==",clientId)),mapBooking,(v)=>ok(sort(v)),fail);

const overlaps=(aStart:string,aEnd:string,bStart:string,bEnd:string)=>aStart<bEnd&&aEnd>bStart;
async function assertNoConflict(input:BookingInput, excludeId?:string){
 if(input.status!=="scheduled") return;
 const day=await getDocs(query(col(COLLECTIONS.bookings),where("date","==",input.date)));
 for(const snap of day.docs){if(snap.id===excludeId)continue;const b=mapBooking(snap.id,snap.data());if(b.status!=="scheduled"||!overlaps(input.startTime,input.endTime,b.startTime,b.endTime))continue;
  if(input.clientId&&b.clientId===input.clientId)throw new Error("Client is already booked during this time.");
  if(input.bookingType==="pt"&&b.bookingType==="pt"&&input.trainerId&&b.trainerId===input.trainerId)throw new Error("Trainer is already booked during this time.");
 }
}
export async function createBooking(input:BookingInput){const safe=bookingSchema.parse(input);if(safe.bookingType==="pt")await assertPtAssignmentValid(safe);await assertNoConflict(safe);return (await addDoc(col(COLLECTIONS.bookings),{...safe,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})).id;}
export async function updateBooking(id:string,input:BookingInput){const safe=bookingSchema.parse(input);if(safe.bookingType==="pt"&&safe.status==="scheduled")await assertPtAssignmentValid(safe);await assertNoConflict(safe,id);await updateDoc(doc(db,COLLECTIONS.bookings,id),{...safe,updatedAt:serverTimestamp()});}
export async function updateBookingStatus(id:string,status:BookingStatus){await updateDoc(doc(db,COLLECTIONS.bookings,id),{status,updatedAt:serverTimestamp()});}
