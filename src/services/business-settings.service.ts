import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, type DocumentData } from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { businessBillingSchema } from "@/lib/invoice-validation";
import { COLLECTIONS } from "./firestore.service";
import type { BusinessBillingSettings } from "@/types/models";

export const DEFAULT_BILLING_SETTINGS: BusinessBillingSettings = {
  businessName: "REBUILD FITNESS", logoUrl: "", address: "", phone: "", email: "", gstin: "",
  taxEnabled: false, taxRate: 0, invoicePrefix: "INV", currency: "INR",
};

const mapSettings = (d?: DocumentData): BusinessBillingSettings => ({
  businessName: d?.["businessName"] ?? DEFAULT_BILLING_SETTINGS.businessName,
  logoUrl: d?.["logoUrl"] ?? "", address: d?.["address"] ?? "", phone: d?.["phone"] ?? "",
  email: d?.["email"] ?? "", gstin: d?.["gstin"] ?? "", taxEnabled: Boolean(d?.["taxEnabled"]),
  taxRate: Number(d?.["taxRate"] ?? 0), invoicePrefix: d?.["invoicePrefix"] ?? "INV", currency: "INR",
});

export async function getBusinessSettings() {
  return mapSettings((await getDoc(doc(db, COLLECTIONS.settings, "business"))).data());
}
export function subscribeBusinessSettings(onData:(value:BusinessBillingSettings)=>void,onError:(e:Error)=>void){
  return onSnapshot(doc(db,COLLECTIONS.settings,"business"),snap=>onData(mapSettings(snap.data())),onError);
}
export async function saveBusinessSettings(input:BusinessBillingSettings){
  const value=businessBillingSchema.parse(input);
  await setDoc(doc(db,COLLECTIONS.settings,"business"),{...value,updatedAt:serverTimestamp()},{merge:true});
}