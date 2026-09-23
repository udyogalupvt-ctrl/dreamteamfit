import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { formatDate, formatDateISO } from "@/lib/format";
import { recordLeadFollowUp, subscribeLeadLogs } from "@/services/lead-logs.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { CUSTOMER_RESPONSES, FOLLOWUP_PRIORITIES, NEXT_ACTIONS, type FollowUpPriority } from "@/types/models";

interface Target { inquiryId: string | null; clientId: string; name: string; phone: string; currentFollowUpId?: string | null }

export function RecordFollowUpDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const { user } = useAuth();
  const blank = { customerSaid: "", response: "Interested", nextAction: "Call Again", nextCallDate: "", nextCallTime: "10:00", expectedJoinDate: "", expectedVisitDate: "", priority: "medium" as FollowUpPriority, notes: "" };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (target) setF(blank); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await recordLeadFollowUp({ ...f, inquiryId: target.inquiryId, clientId: target.clientId, createdBy: user?.displayName || user?.email || "Staff" }, target);
      toast.success("Follow-up recorded", { description: f.nextCallDate ? `Next call ${formatDateISO(f.nextCallDate)}` : undefined });
      onClose();
    } catch (e) { toast.error(firestoreErrorMessage(e)); } finally { setSaving(false); }
  };
  return (
    <FormDialog open={!!target} onOpenChange={(o) => !o && onClose()} title={`Record follow-up · ${target?.name ?? ""}`} description="Pick options; add free text only where needed. History is never overwritten."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>Save follow-up</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What did the customer say?" htmlFor="r-said" className="sm:col-span-2"><Textarea id="r-said" rows={2} value={f.customerSaid} onChange={(e) => set("customerSaid", e.target.value)} placeholder="e.g. Will join next week after salary" /></Field>
        <Field label="Customer response" htmlFor="r-resp"><Select value={f.response} onValueChange={(v) => set("response", v)}><SelectTrigger id="r-resp" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CUSTOMER_RESPONSES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Next action" htmlFor="r-next"><Select value={f.nextAction} onValueChange={(v) => set("nextAction", v)}><SelectTrigger id="r-next" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{NEXT_ACTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Expected next call date" htmlFor="r-cd"><Input id="r-cd" type="date" value={f.nextCallDate} onChange={(e) => set("nextCallDate", e.target.value)} /></Field>
        <Field label="Expected next call time" htmlFor="r-ct"><Input id="r-ct" type="time" value={f.nextCallTime} onChange={(e) => set("nextCallTime", e.target.value)} /></Field>
        <Field label="Expected gym visit date" htmlFor="r-vd"><Input id="r-vd" type="date" value={f.expectedVisitDate} onChange={(e) => set("expectedVisitDate", e.target.value)} /></Field>
        <Field label="Expected join date" htmlFor="r-jd"><Input id="r-jd" type="date" value={f.expectedJoinDate} onChange={(e) => set("expectedJoinDate", e.target.value)} /></Field>
        <Field label="Priority" htmlFor="r-pr"><Select value={f.priority} onValueChange={(v) => set("priority", v as FollowUpPriority)}><SelectTrigger id="r-pr" className="w-full capitalize"><SelectValue /></SelectTrigger><SelectContent>{FOLLOWUP_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Notes" htmlFor="r-notes"><Input id="r-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </FormDialog>
  );
}

export function LeadTimeline({ field, id }: { field: "inquiryId" | "clientId"; id: string }) {
  const logs = useLive((ok, fail) => subscribeLeadLogs(field, id, ok, fail), [] as LeadLog[], [field, id]);
  if (logs.loading) return <p className="text-meta">Loading timeline…</p>;
  if (!logs.data.length) return <p className="text-meta">No conversations recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-4">
      {logs.data.map((l) => (
        <li key={l.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" aria-hidden />
          <p className="text-xs font-bold">{formatDate(l.createdAt)} · {l.response}</p>
          {l.customerSaid ? <p className="text-sm">Customer said: “{l.customerSaid}”</p> : null}
          <p className="text-meta">
            {[l.nextAction && `Next: ${l.nextAction}`, l.nextCallDate && `Call ${formatDateISO(l.nextCallDate)} ${l.nextCallTime}`, l.expectedVisitDate && `Visit ${formatDateISO(l.expectedVisitDate)}`, l.expectedJoinDate && `Join ${formatDateISO(l.expectedJoinDate)}`].filter(Boolean).join(" · ")}
          </p>
          {l.notes ? <p className="text-meta">{l.notes}</p> : null}
          <p className="text-meta">by {l.createdBy}</p>
        </li>
      ))}
    </ol>
  );
}
