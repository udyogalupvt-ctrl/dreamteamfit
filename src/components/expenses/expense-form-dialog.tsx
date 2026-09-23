import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { expenseSchema, type ExpenseFormValues } from "@/lib/expense-validation";
import { todayISO } from "@/lib/format";
import { createExpense, updateExpense } from "@/services/expenses.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS, type Expense } from "@/types/models";

const empty: ExpenseFormValues = { title: "", category: "Other", amount: 0, paymentMethod: "Cash", date: "", description: "", notes: "" };
export function ExpenseFormDialog({open,onOpenChange,expense}:{open:boolean;onOpenChange:(open:boolean)=>void;expense?:Expense|null}){
  const {user}=useAuth(); const [values,setValues]=useState<ExpenseFormValues>({...empty,date:todayISO()}); const [errors,setErrors]=useState<Record<string,string>>({}); const [saving,setSaving]=useState(false);
  useEffect(()=>{if(!open)return;setValues(expense?{title:expense.title,category:expense.category,amount:expense.amount,paymentMethod:expense.paymentMethod,date:expense.date,description:expense.description,notes:expense.notes}:{...empty,date:todayISO()});setErrors({});},[open,expense]);
  const set=<K extends keyof ExpenseFormValues>(key:K,value:ExpenseFormValues[K])=>setValues(v=>({...v,[key]:value}));
  const submit=async()=>{const parsed=expenseSchema.safeParse(values);if(!parsed.success){setErrors(Object.fromEntries(parsed.error.issues.map(i=>[String(i.path[0]),i.message])));return;}if(!user){toast.error("Your staff session is unavailable");return;}setSaving(true);try{const staff={uid:user.uid,name:user.displayName||user.email||"Staff"};if(expense)await updateExpense(expense,parsed.data,staff);else await createExpense(parsed.data,staff);toast.success(expense?"Expense updated":"Expense added",{description:parsed.data.title});onOpenChange(false);}catch(error){toast.error(firestoreErrorMessage(error));}finally{setSaving(false);}};
  return <FormDialog open={open} onOpenChange={onOpenChange} title={expense?"Edit expense":"Add expense"} description="Record an actual business expense." footer={<><Button variant="outline" onClick={()=>onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={()=>void submit()} disabled={saving}>{saving?"Saving…":expense?"Save changes":"Add expense"}</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Expense Title" htmlFor="expense-title" required error={errors.title} className="sm:col-span-2"><Input id="expense-title" value={values.title} onChange={e=>set("title",e.target.value)} maxLength={120}/></Field>
      <Field label="Category" htmlFor="expense-category" required error={errors.category}><Select value={values.category} onValueChange={v=>set("category",v as ExpenseFormValues["category"])}><SelectTrigger id="expense-category"><SelectValue/></SelectTrigger><SelectContent>{EXPENSE_CATEGORIES.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Amount" htmlFor="expense-amount" required error={errors.amount}><Input id="expense-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={values.amount||""} onChange={e=>set("amount",Number(e.target.value))}/></Field>
      <Field label="Payment Method" htmlFor="expense-payment" required error={errors.paymentMethod}><Select value={values.paymentMethod} onValueChange={v=>set("paymentMethod",v as ExpenseFormValues["paymentMethod"])}><SelectTrigger id="expense-payment"><SelectValue/></SelectTrigger><SelectContent>{EXPENSE_PAYMENT_METHODS.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Date" htmlFor="expense-date" required error={errors.date}><Input id="expense-date" type="date" value={values.date} onChange={e=>set("date",e.target.value)}/></Field>
      <Field label="Description" htmlFor="expense-description" error={errors.description} className="sm:col-span-2"><Textarea id="expense-description" rows={3} value={values.description} onChange={e=>set("description",e.target.value)} maxLength={1000}/></Field>
      <Field label="Notes" htmlFor="expense-notes" error={errors.notes} className="sm:col-span-2"><Textarea id="expense-notes" rows={3} value={values.notes} onChange={e=>set("notes",e.target.value)} maxLength={1000}/></Field>
    </div>
  </FormDialog>;
}
