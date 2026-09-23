import { addDoc, doc, orderBy, serverTimestamp, updateDoc, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { groupClassSchema, normalizeTrainerId } from "@/lib/scheduling-validation";
import type { GroupClass, GroupClassStatus } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";
export type GroupClassInput=Pick<GroupClass,"name"|"description"|"trainerNameSnapshot"|"date"|"startTime"|"endTime"|"capacity"|"location"|"status">;
export const mapGroupClass=(id:string,d:DocumentData):GroupClass=>({id,name:d["name"]??"",description:d["description"]??"",trainerId:d["trainerId"]??"",trainerNameSnapshot:d["trainerNameSnapshot"]??"",date:d["date"]??"",startTime:d["startTime"]??"",endTime:d["endTime"]??"",capacity:Number(d["capacity"]??0),bookedCount:Number(d["bookedCount"]??0),location:d["location"]??"",status:d["status"]??"scheduled",createdAt:toDate(d["createdAt"]),updatedAt:toDate(d["updatedAt"])});
export const subscribeGroupClasses=(ok:(v:GroupClass[])=>void,fail:(e:Error)=>void)=>subscribeCollection(COLLECTIONS.groupClasses,mapGroupClass,ok,fail,orderBy("date","asc"));
export async function createGroupClass(input:GroupClassInput){const safe=groupClassSchema.parse(input);return(await addDoc(col(COLLECTIONS.groupClasses),{...safe,trainerId:normalizeTrainerId(safe.trainerNameSnapshot),bookedCount:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})).id;}
export async function updateGroupClass(id:string,input:GroupClassInput,currentBooked=0){const safe=groupClassSchema.parse(input);if(safe.capacity<currentBooked)throw new Error(`Capacity cannot be below ${currentBooked} enrolled members.`);await updateDoc(doc(db,COLLECTIONS.groupClasses,id),{...safe,trainerId:normalizeTrainerId(safe.trainerNameSnapshot),updatedAt:serverTimestamp()});}
export async function updateGroupClassStatus(id:string,status:GroupClassStatus){await updateDoc(doc(db,COLLECTIONS.groupClasses,id),{status,updatedAt:serverTimestamp()});}
