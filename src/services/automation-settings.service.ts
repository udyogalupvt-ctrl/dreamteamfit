import { doc,onSnapshot,serverTimestamp,setDoc } from "firebase/firestore";import { db } from "@/lib/firebase";import { DEFAULT_AUTOMATION_SETTINGS } from "@/lib/automation-templates";import { COLLECTIONS } from "./firestore.service";import type { AutomationSettings } from "@/types/models";
const ref=()=>doc(db,COLLECTIONS.settings,"automation");
export function subscribeAutomationSettings(ok:(x:AutomationSettings)=>void,fail:(e:Error)=>void){return onSnapshot(ref(),s=>ok({...DEFAULT_AUTOMATION_SETTINGS,...(s.data()??{})}),fail)}
export async function saveAutomationSettings(value:AutomationSettings){await setDoc(ref(),{...value,updatedAt:serverTimestamp()},{merge:true})}
