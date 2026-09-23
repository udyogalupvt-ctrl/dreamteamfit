import type { BusinessBillingSettings, Invoice, InvoiceItem, InvoicePaymentStatus } from "@/types/models";

export function calculateInvoiceTotals(items:Pick<InvoiceItem,"quantity"|"unitPrice">[],discount:number,settings:Pick<BusinessBillingSettings,"taxEnabled"|"taxRate">,amountPaid:number){
  const subtotal=round(items.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0));
  const safeDiscount=round(Math.min(Math.max(discount,0),subtotal));
  const taxable=Math.max(0,subtotal-safeDiscount);
  const tax=settings.taxEnabled?round(taxable*settings.taxRate/100):0;
  const total=round(taxable+tax);
  const paid=round(Math.min(Math.max(amountPaid,0),total));
  return {subtotal,discount:safeDiscount,tax,total,amountPaid:paid,balanceDue:round(total-paid)};
}
export function derivePaymentStatus(total:number,amountPaid:number):InvoicePaymentStatus{
  if(total>0&&amountPaid>=total)return "paid";
  if(amountPaid>0)return "partial";
  return "pending";
}
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
export function createPublicToken(){
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
export function getInvoicePublicUrl(invoice:Pick<Invoice,"publicToken">){
  const path=`/invoice/${encodeURIComponent(invoice.publicToken)}`;
  return typeof window==="undefined"?path:new URL(path,window.location.origin).toString();
}