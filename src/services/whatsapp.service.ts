import { doc,getDoc,orderBy,runTransaction,serverTimestamp,updateDoc,type DocumentData } from "firebase/firestore";
import { getFunctions,httpsCallable } from "firebase/functions";
import { app,db } from "@/lib/firebase";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import type { Client,CommunicationProviderName,WhatsAppMessage,WhatsAppMessageType } from "@/types/models";
import { COLLECTIONS,subscribeCollection,toDate } from "./firestore.service";

type SendInput={client:Pick<Client,"id"|"fullName"|"phone"|"whatsappPhone"|"whatsappOptIn">;type:WhatsAppMessageType;referenceId:string;templateName:string;templateLanguage?:string;parameters?:string[];messagePreview:string;provider:CommunicationProviderName};
const safeId=(x:string)=>x.replace(/[^a-zA-Z0-9_-]/g,"_");
export const mapWhatsAppMessage=(id:string,d:DocumentData):WhatsAppMessage=>({id,clientId:d["clientId"]??"",clientNameSnapshot:d["clientNameSnapshot"]??"",phoneSnapshot:d["phoneSnapshot"]??"",normalizedPhone:d["normalizedPhone"]??"",type:d["type"]??"follow_up",referenceId:d["referenceId"]??"",provider:d["provider"]??"mock",templateName:d["templateName"]??"",templateLanguage:d["templateLanguage"]??"en",messagePreview:d["messagePreview"]??"",status:d["status"]??"queued",providerMessageId:d["providerMessageId"]??"",sentAt:d["sentAt"]?toDate(d["sentAt"]):null,deliveredAt:d["deliveredAt"]?toDate(d["deliveredAt"]):null,readAt:d["readAt"]?toDate(d["readAt"]):null,failedAt:d["failedAt"]?toDate(d["failedAt"]):null,errorCode:d["errorCode"]??"",errorMessage:d["errorMessage"]??"",createdAt:toDate(d["createdAt"]),updatedAt:toDate(d["updatedAt"])});
export const subscribeWhatsAppMessages=(ok:(x:WhatsAppMessage[])=>void,fail:(e:Error)=>void)=>subscribeCollection(COLLECTIONS.whatsappMessages,mapWhatsAppMessage,ok,fail,orderBy("createdAt","desc"));
export async function sendWhatsAppMessage(input:SendInput){
  let recipient=input.client;
  if(input.type!=="test"){const clientSnap=await getDoc(doc(db,COLLECTIONS.clients,input.client.id));if(!clientSnap.exists())throw new Error("Client record not found.");const data=clientSnap.data();recipient={...input.client,phone:String(data["phone"]??input.client.phone),whatsappPhone:String(data["whatsappPhone"]??data["phone"]??input.client.phone),whatsappOptIn:Boolean(data["whatsappOptIn"])};if(!recipient.whatsappOptIn)throw new Error("This client has not opted in to WhatsApp messages.");}
  const normalized=normalizeWhatsAppPhone(recipient.whatsappPhone||recipient.phone);if(!normalized.ok)throw new Error(normalized.error);
  const id=safeId(`${input.type}__${input.referenceId}`),ref=doc(db,COLLECTIONS.whatsappMessages,id);
  const claimed=await runTransaction(db,async tx=>{const existing=await tx.get(ref);if(existing.exists()&&["queued","sent","delivered","read"].includes(String(existing.data()["status"])))return false;const now=serverTimestamp();tx.set(ref,{clientId:recipient.id,clientNameSnapshot:recipient.fullName,phoneSnapshot:recipient.whatsappPhone||recipient.phone,normalizedPhone:normalized.value,type:input.type,referenceId:input.referenceId,provider:input.provider,templateName:input.templateName,templateLanguage:input.templateLanguage??"en",messagePreview:input.messagePreview,status:"queued",providerMessageId:"",sentAt:null,deliveredAt:null,readAt:null,failedAt:null,errorCode:"",errorMessage:"",createdAt:existing.data()?.["createdAt"]??now,updatedAt:now},{merge:true});return true});
  if(!claimed)return {duplicate:true,messageId:id};
  if(input.provider==="mock")return {duplicate:false,messageId:id};
  try{const call=httpsCallable(getFunctions(app),"sendWhatsAppMessage");await call({messageId:id,parameters:input.parameters??[]});return {duplicate:false,messageId:id}}catch(error){await updateDoc(ref,{status:"failed",failedAt:serverTimestamp(),errorCode:"backend_unavailable",errorMessage:error instanceof Error?error.message:"WhatsApp delivery failed",updatedAt:serverTimestamp()});throw error}
}
export async function testWhatsAppConnection(){const call=httpsCallable(getFunctions(app),"testWhatsAppConnection");return (await call({})).data as {configured:boolean;detail:string};}