import { useEffect, useMemo, useState } from "react";
import { Dumbbell, Pencil, Plus, Power, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLive } from "@/hooks/use-live-query";
import { formatPrice, todayISO } from "@/lib/format";
import { calculateShare, DEFAULT_PT_DAYS, PT_DURATION_LABELS, savePtPackage, saveTrainer, subscribePtPackages, subscribeTrainers, type PtPackageInput, type TrainerInput } from "@/services/pt.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { PT_DURATION_TYPES, type PtDurationType, type PtPackage, type ShareType, type Trainer } from "@/types/models";

const crumbs = [{ label: "Home", to: "/dashboard" }, { label: "Packages" }];

export function PtPackagesSection() {
  const live = useLive(subscribePtPackages, [], []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PtDurationType>("all");
  const [editing, setEditing] = useState<PtPackage | null | "new">(null);
  const rows = useMemo(() => live.data.filter((p) => (filter === "all" || p.durationType === filter) && p.name.toLowerCase().includes(search.toLowerCase())), [live.data, search, filter]);
  const toggle = (p: PtPackage) => void savePtPackage({ ...strip(p), isActive: !p.isActive }, p.id).then(() => toast.success(p.isActive ? "Deactivated" : "Activated"), (e) => toast.error(firestoreErrorMessage(e)));
  return (
    <div className="space-y-5">
      <PageHeader title="PT packages" description="Personal training options. Durations and prices are set by the admin." breadcrumbs={crumbs} actions={<Button onClick={() => setEditing("new")}><Plus /> New PT package</Button>} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search PT packages…" label="Search PT packages" />
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}><SelectTrigger aria-label="Filter duration"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All durations</SelectItem>{PT_DURATION_TYPES.map((d) => <SelectItem key={d} value={d}>{PT_DURATION_LABELS[d]}</SelectItem>)}</SelectContent></Select>
      </div>
      {live.loading ? <LoadingRows rows={3} /> : live.error ? <ErrorState error={live.error} /> : !rows.length ? <EmptyState icon={Dumbbell} title="No PT packages" description="Create Day, Monthly, Yearly or custom PT packages." action={<Button onClick={() => setEditing("new")}><Plus /> New PT package</Button>} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <article key={p.id} className="surface-card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2"><div><h3 className="text-card-title">{p.name}</h3><p className="text-meta">{PT_DURATION_LABELS[p.durationType]} · {p.durationDays} days</p></div><StatusPill tone={p.isActive ? "success" : "warning"}>{p.isActive ? "Active" : "Inactive"}</StatusPill></div>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.description || "No description"}</p>
              <p className="text-stat mt-3">{formatPrice(p.price)}</p>
              <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil /> Edit</Button><Button size="sm" variant="outline" onClick={() => toggle(p)}><Power /> {p.isActive ? "Deactivate" : "Activate"}</Button></div>
            </article>
          ))}
        </div>
      )}
      <PtPackageDialog item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
const strip = <T extends { id: string; createdAt: Date; updatedAt: Date }>(x: T) => { const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = x; return rest; };

function PtPackageDialog({ item, onClose }: { item: PtPackage | null | "new"; onClose: () => void }) {
  const blank: PtPackageInput = { name: "", durationType: "monthly", durationDays: 30, price: 0, description: "", isActive: true };
  const [f, setF] = useState<PtPackageInput>(blank);
  const [err, setErr] = useState("");
  useEffect(() => { if (item) { setF(item === "new" ? blank : strip(item)); setErr(""); } }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (f.name.trim().length < 2) return setErr("Name is required");
    if (!(f.durationDays >= 1)) return setErr("Duration must be at least 1 day");
    if (!(f.price >= 0)) return setErr("Price is invalid");
    try { await savePtPackage({ ...f, name: f.name.trim() }, item && item !== "new" ? item.id : undefined); toast.success("PT package saved"); onClose(); } catch (e) { toast.error(firestoreErrorMessage(e)); }
  };
  return (
    <FormDialog open={!!item} onOpenChange={(o) => !o && onClose()} title={item === "new" ? "New PT package" : "Edit PT package"} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{err}</p> : null}
        <Field label="Name" htmlFor="pp-name" required className="sm:col-span-2"><Input id="pp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Monthly PT" /></Field>
        <Field label="Duration type" htmlFor="pp-type"><Select value={f.durationType} onValueChange={(v) => setF({ ...f, durationType: v as PtDurationType, durationDays: DEFAULT_PT_DAYS[v as PtDurationType] })}><SelectTrigger id="pp-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PT_DURATION_TYPES.map((d) => <SelectItem key={d} value={d}>{PT_DURATION_LABELS[d]}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Duration (days)" htmlFor="pp-days"><Input id="pp-days" type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: Number(e.target.value) })} /></Field>
        <Field label="Price ₹" htmlFor="pp-price" required><Input id="pp-price" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Active</label>
        <Field label="Description" htmlFor="pp-desc" className="sm:col-span-2"><Textarea id="pp-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </FormDialog>
  );
}

export function TrainersSection() {
  const live = useLive(subscribeTrainers, [], []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Trainer | null | "new">(null);
  const rows = live.data.filter((t) => (status === "all" || t.status === status) && [t.name, t.phone, t.specialization].some((v) => v.toLowerCase().includes(search.toLowerCase())));
  const toggle = (t: Trainer) => void saveTrainer({ ...strip(t), status: t.status === "active" ? "inactive" : "active" }, t.id).then(() => toast.success("Trainer updated"), (e) => toast.error(firestoreErrorMessage(e)));
  return (
    <div className="space-y-5">
      <PageHeader title="Trainers" description="Trainer profiles and default PT share (percentage or fixed)." breadcrumbs={crumbs} actions={<Button onClick={() => setEditing("new")}><Plus /> New trainer</Button>} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search trainers…" label="Search trainers" />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}><SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select>
      </div>
      {live.loading ? <LoadingRows rows={3} /> : live.error ? <ErrorState error={live.error} /> : !rows.length ? <EmptyState icon={UserRound} title="No trainers" description="Add trainers to assign PT and track payouts." action={<Button onClick={() => setEditing("new")}><Plus /> New trainer</Button>} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => { const ex = calculateShare(5000, t.defaultShareType, t.defaultTrainerShare); return (
            <article key={t.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><Link to="/trainers/$trainerId" params={{ trainerId: t.id }} className="text-card-title block truncate hover:underline">{t.name}</Link><p className="text-meta">{t.specialization || "Trainer"} · {t.phone}</p></div><StatusPill tone={t.status === "active" ? "success" : "warning"}>{t.status}</StatusPill></div>
              <p className="mt-3 text-sm">Share: <b>{t.defaultShareType === "percentage" ? `${t.defaultTrainerShare}%` : formatPrice(t.defaultTrainerShare)}</b></p>
              <p className="text-meta">On ₹5,000 PT: trainer {formatPrice(ex.trainerShareAmount)} · gym {formatPrice(ex.gymShareAmount)}</p>
              <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(t)}><Pencil /> Edit</Button><Button size="sm" variant="outline" onClick={() => toggle(t)}><Power /> {t.status === "active" ? "Deactivate" : "Activate"}</Button></div>
            </article>); })}
        </div>
      )}
      <TrainerDialog item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function TrainerDialog({ item, onClose }: { item: Trainer | null | "new"; onClose: () => void }) {
  const blank: TrainerInput = { name: "", phone: "", email: "", specialization: "", joiningDate: todayISO(), status: "active", defaultShareType: "percentage", defaultTrainerShare: 0, notes: "" };
  const [f, setF] = useState<TrainerInput>(blank);
  const [err, setErr] = useState("");
  useEffect(() => { if (item) { setF(item === "new" ? blank : strip(item)); setErr(""); } }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (f.name.trim().length < 2) return setErr("Name is required");
    if (f.defaultTrainerShare < 0 || (f.defaultShareType === "percentage" && f.defaultTrainerShare > 100)) return setErr("Share percentage must be 0–100");
    try { await saveTrainer({ ...f, name: f.name.trim() }, item && item !== "new" ? item.id : undefined); toast.success("Trainer saved"); onClose(); } catch (e) { toast.error(firestoreErrorMessage(e)); }
  };
  return (
    <FormDialog open={!!item} onOpenChange={(o) => !o && onClose()} title={item === "new" ? "New trainer" : "Edit trainer"} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {err ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{err}</p> : null}
        <Field label="Name" htmlFor="t-name" required><Input id="t-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="t-phone"><Input id="t-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="t-email"><Input id="t-email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Specialization" htmlFor="t-spec"><Input id="t-spec" value={f.specialization} onChange={(e) => setF({ ...f, specialization: e.target.value })} /></Field>
        <Field label="Joining date" htmlFor="t-join"><Input id="t-join" type="date" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></Field>
        <Field label="Status" htmlFor="t-status"><Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Trainer["status"] })}><SelectTrigger id="t-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></Field>
        <Field label="Default share type" htmlFor="t-stype"><Select value={f.defaultShareType} onValueChange={(v) => setF({ ...f, defaultShareType: v as ShareType })}><SelectTrigger id="t-stype" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentage">Percentage</SelectItem><SelectItem value="fixed">Fixed amount</SelectItem></SelectContent></Select></Field>
        <Field label={f.defaultShareType === "percentage" ? "Trainer share %" : "Trainer share ₹"} htmlFor="t-sval"><Input id="t-sval" type="number" min={0} value={f.defaultTrainerShare} onChange={(e) => setF({ ...f, defaultTrainerShare: Number(e.target.value) })} /></Field>
        <Field label="Notes" htmlFor="t-notes" className="sm:col-span-2"><Textarea id="t-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </FormDialog>
  );
}
