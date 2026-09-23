import { addDoc,doc,orderBy,serverTimestamp,updateDoc,type DocumentData } from "firebase/firestore";
import { adapterFor } from "@/lib/biometric-adapters";
import type { BiometricDevice } from "@/types/models";
import { col,COLLECTIONS,subscribeCollection,toDate } from "./firestore.service";
export type DeviceInput=Omit<BiometricDevice,"id"|"createdAt"|"updatedAt"|"lastSyncAt">;
export const mapDevice=(id:string,d:DocumentData):BiometricDevice=>({id,name:d["name"]??"",manufacturer:d["manufacturer"]??"Other",model:d["model"]??"",serialNumber:d["serialNumber"]??"",deviceType:d["deviceType"]??"Biometric terminal",location:d["location"]??"",connectionType:d["connectionType"]??"Other",ipAddress:d["ipAddress"]??"",port:d["port"]==null?null:Number(d["port"]),status:d["status"]??"unknown",integrationType:d["integrationType"]??"manual",lastSyncAt:d["lastSyncAt"]?toDate(d["lastSyncAt"]):null,createdAt:toDate(d["createdAt"]),updatedAt:toDate(d["updatedAt"])});
export const subscribeDevices=(ok:(x:BiometricDevice[])=>void,fail:(e:Error)=>void)=>subscribeCollection(COLLECTIONS.biometricDevices,mapDevice,ok,fail,orderBy("createdAt","desc"));
export async function saveDevice(input:DeviceInput,id?:string){const data={...input,updatedAt:serverTimestamp()};if(id){await updateDoc(doc(dbRef(),id),data);return id}const ref=await addDoc(col(COLLECTIONS.biometricDevices),{...data,lastSyncAt:null,createdAt:serverTimestamp()});return ref.id}
const dbRef=()=>col(COLLECTIONS.biometricDevices);
export async function setDeviceStatus(id:string,status:BiometricDevice["status"]){await updateDoc(doc(dbRef(),id),{status,updatedAt:serverTimestamp()})}
export async function testDeviceConnection(device:BiometricDevice){return adapterFor(device).testConnection()}
