import { useEffect, useMemo, useState } from "react";
import {
  Dumbbell,
  Pencil,
  Plus,
  Power,
  Smartphone,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StaffDialog } from "@/components/staff/staff-dialog";
import { TrainerAppDialog } from "@/components/staff/trainer-app-dialog";
import { useAccess } from "@/hooks/use-access";
import { useBin } from "@/hooks/use-bin";
import { useStaffTrainers } from "@/hooks/use-staff-trainers";
import { useLive } from "@/hooks/use-live-query";
import { formatPrice, todayISO } from "@/lib/format";
import { binTrainer } from "@/services/recycle-bin.service";
import { cn } from "@/lib/utils";
import {
  calculateShare,
  PT_DURATION_LABELS,
  PT_SCHEDULE_LABELS,
  savePtPackage,
  saveTrainer,
  subscribePtPackages,
  type PtPackageInput,
  type TrainerInput,
} from "@/services/pt.service";
import { DurationFields } from "@/components/packages/duration-fields";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { staffOfTrainer } from "@/services/staff-trainers.service";
import { saveStaff } from "@/services/staff.service";
import {
  PT_DURATION_TYPES,
  type PtDurationType,
  type PtPackage,
  type ShareType,
  type Staff,
  type Trainer,
} from "@/types/models";

const crumbs = [{ label: "Home", to: "/dashboard" }, { label: "Packages" }];

export function PtPackagesSection() {
  const live = useLive(subscribePtPackages, [], []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PtDurationType>("all");
  const [editing, setEditing] = useState<PtPackage | null | "new">(null);
  const rows = useMemo(
    () =>
      live.data.filter(
        (p) =>
          (filter === "all" || p.durationType === filter) &&
          p.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [live.data, search, filter],
  );
  const toggle = (p: PtPackage) =>
    void savePtPackage({ ...strip(p), isActive: !p.isActive }, p.id).then(
      () => toast.success(p.isActive ? "Deactivated" : "Activated"),
      (e) => toast.error(firestoreErrorMessage(e)),
    );
  return (
    <div className="space-y-5">
      <PageHeader
        title="PT packages"
        description="Personal training options. Durations and prices are set by the admin."
        breadcrumbs={crumbs}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> New PT package
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search PT packages…"
          label="Search PT packages"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger aria-label="Filter duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All durations</SelectItem>
            {PT_DURATION_TYPES.map((d) => (
              <SelectItem key={d} value={d}>
                {PT_DURATION_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {live.loading ? (
        <LoadingRows rows={3} />
      ) : live.error ? (
        <ErrorState error={live.error} />
      ) : !rows.length ? (
        <EmptyState
          icon={Dumbbell}
          title="No PT packages"
          description="Create Day, Monthly, Yearly or custom PT packages."
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus /> New PT package
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <article key={p.id} className="surface-card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-card-title">{p.name}</h3>
                  <p className="text-meta">
                    {PT_SCHEDULE_LABELS[p.schedule]} · {PT_DURATION_LABELS[p.durationType]} ·{" "}
                    {p.durationDays} days
                  </p>
                </div>
                <StatusPill tone={p.isActive ? "success" : "warning"}>
                  {p.isActive ? "Active" : "Inactive"}
                </StatusPill>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {p.description || "No description"}
              </p>
              <p className="text-stat mt-3">{formatPrice(p.price)}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggle(p)}>
                  <Power /> {p.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <PtPackageDialog item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
/** Day / Monthly / Yearly label for the list filter, from the number of days. */
const ptTypeFor = (days: number): PtDurationType =>
  days <= 1 ? "day" : days >= 360 ? "yearly" : days % 30 === 0 ? "monthly" : "custom";
const strip = <T extends { id: string; createdAt: Date; updatedAt: Date }>(x: T) => {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = x;
  return rest;
};

function PtPackageDialog({
  item,
  onClose,
}: {
  item: PtPackage | null | "new";
  onClose: () => void;
}) {
  const blank: PtPackageInput = {
    name: "",
    schedule: "daily",
    durationType: "monthly",
    durationDays: 30,
    price: 0,
    description: "",
    isActive: true,
    maxDiscount: null,
  };
  const [f, setF] = useState<PtPackageInput>(blank);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (item) {
      setF(item === "new" ? blank : strip(item));
      setErr("");
    }
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (f.name.trim().length < 2) return setErr("Name is required");
    if (!(f.durationDays >= 1)) return setErr("Duration must be at least 1 day");
    if (!(f.price >= 0)) return setErr("Price is invalid");
    if (f.maxDiscount !== null && !(f.maxDiscount >= 0)) return setErr("Max discount is invalid");
    try {
      await savePtPackage(
        { ...f, name: f.name.trim(), durationType: ptTypeFor(f.durationDays) },
        item && item !== "new" ? item.id : undefined,
      );
      toast.success("PT package saved");
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <FormDialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={item === "new" ? "New PT package" : "Edit PT package"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save()}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {err ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {err}
          </p>
        ) : null}
        <Field label="Name" htmlFor="pp-name" required className="sm:col-span-2">
          <Input
            id="pp-name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="e.g. Monthly PT"
          />
        </Field>
        <Field
          label="Sessions"
          htmlFor="pp-schedule"
          required
          className="sm:col-span-2"
          hint="Daily and alternate days are priced separately: make one package for each."
        >
          <div id="pp-schedule" role="radiogroup" className="grid grid-cols-2 gap-2">
            {(["daily", "alternate"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={f.schedule === v}
                onClick={() => setF({ ...f, schedule: v })}
                className={cn(
                  "rounded-xl border p-3 text-left text-sm font-semibold transition-colors",
                  f.schedule === v
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent",
                )}
              >
                {PT_SCHEDULE_LABELS[v]}
                <span className="text-meta block font-normal">
                  {v === "daily" ? "Every day with the trainer" : "Every other day"}
                </span>
              </button>
            ))}
          </div>
        </Field>
        <DurationFields
          idPrefix="pp"
          totalDays={f.durationDays}
          onChange={(d) => setF({ ...f, durationDays: d })}
        />
        <Field label="Price ₹" htmlFor="pp-price" required>
          <Input
            id="pp-price"
            type="number"
            min={0}
            value={f.price}
            onChange={(e) => setF({ ...f, price: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max discount ₹" htmlFor="pp-maxdisc" hint="Empty = no limit">
          <Input
            id="pp-maxdisc"
            type="number"
            min={0}
            placeholder="No limit"
            value={f.maxDiscount ?? ""}
            onChange={(e) =>
              setF({ ...f, maxDiscount: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} />{" "}
          Active
        </label>
        <Field label="Description" htmlFor="pp-desc" className="sm:col-span-2">
          <Textarea
            id="pp-desc"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

export function TrainersSection() {
  // Trainers are made once, on the Staff page (role "Trainer"); this keeps their PT profiles in step.
  const { staff, trainers: live } = useStaffTrainers();
  const { can } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Trainer | null>(null);
  const [adding, setAdding] = useState(false);
  const [app, setApp] = useState<string | null>(null);
  // A trainer just added: open their PT share as soon as their profile appears.
  const [shareNext, setShareNext] = useState<string | null>(null);
  useEffect(() => {
    const t = shareNext ? live.data.find((x) => x.staffId === shareNext) : undefined;
    if (!t) return;
    setShareNext(null);
    setEditing(t);
  }, [shareNext, live.data]);
  // Delete (only trainers not on the Staff page; staff trainers are deleted on the Staff page).
  const bin = useBin();
  const [deleting, setDeleting] = useState<Trainer | null>(null);
  const rows = live.data.filter(
    (t) =>
      (status === "all" || t.status === status) &&
      [t.name, t.phone, t.specialization].some((v) =>
        v.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const appTrainer = app ? (live.data.find((t) => t.id === app) ?? null) : null;
  const toggle = (t: Trainer) =>
    void saveTrainer(
      { ...strip(t), status: t.status === "active" ? "inactive" : "active", offWithStaff: false },
      t.id,
    ).then(
      () => toast.success(t.status === "active" ? "No PT for this trainer now" : "Takes PT again"),
      (e) => toast.error(firestoreErrorMessage(e)),
    );
  const addToStaff = async (t: Trainer) => {
    try {
      const id = await saveStaff({
        name: t.name,
        phone: t.phone,
        role: "Trainer",
        joiningDate: t.joiningDate || todayISO(),
        active: t.status === "active",
        isCounsellor: false,
      });
      await saveTrainer({ ...strip(t), staffId: id, counsellorStaffId: id }, t.id);
      toast.success(`${t.name} added to Staff`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Trainers"
        description="Trainers are added once, on the Staff page (role: Trainer). Here you set each one's PT share and trainer app login."
        breadcrumbs={crumbs}
        actions={
          can("staff") ? (
            <Button onClick={() => setAdding(true)}>
              <Plus /> New trainer
            </Button>
          ) : null
        }
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search trainers…"
          label="Search trainers"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger aria-label="Filter status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Taking PT</SelectItem>
            <SelectItem value="inactive">Not taking PT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {live.loading || staff.loading ? (
        <LoadingRows rows={3} />
      ) : live.error ? (
        <ErrorState error={live.error} />
      ) : !rows.length ? (
        <EmptyState
          icon={UserRound}
          title="No trainers"
          description="Add a staff member with the role Trainer: they appear here to set their PT share."
          action={
            can("staff") ? (
              <Button onClick={() => setAdding(true)}>
                <Plus /> New trainer
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => {
            const person = staffOfTrainer(t, staff.data);
            const ex = calculateShare(5000, t.defaultShareType, t.defaultTrainerShare);
            const shareSet = t.defaultTrainerShare > 0;
            return (
              <article key={t.id} className="surface-card flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/trainers/$trainerId"
                      params={{ trainerId: t.id }}
                      className="text-card-title block truncate hover:underline"
                    >
                      {t.name}
                    </Link>
                    <p className="text-meta">
                      {t.specialization || "Trainer"} · {t.phone || "no phone"}
                    </p>
                  </div>
                  <StatusPill tone={t.status === "active" ? "success" : "warning"}>
                    {t.status === "active"
                      ? "Takes PT"
                      : person && !person.active
                        ? "Left"
                        : "No PT"}
                  </StatusPill>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {person ? (
                    <StatusPill tone="info">Staff · {person.role || "Trainer"}</StatusPill>
                  ) : (
                    <StatusPill tone="warning">Not on the Staff page</StatusPill>
                  )}
                  <StatusPill
                    tone={!t.portalCode ? "warning" : t.portalActive ? "success" : "danger"}
                  >
                    {!t.portalCode ? "No trainer app" : t.portalActive ? "App on" : "App off"}
                  </StatusPill>
                </div>
                {shareSet ? (
                  <div>
                    <p className="text-sm">
                      PT share:{" "}
                      <b>
                        {t.defaultShareType === "percentage"
                          ? `${t.defaultTrainerShare}%`
                          : formatPrice(t.defaultTrainerShare)}
                      </b>
                    </p>
                    <p className="text-meta">
                      On ₹5,000 PT: trainer {formatPrice(ex.trainerShareAmount)} · gym{" "}
                      {formatPrice(ex.gymShareAmount)}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm">
                    PT share not set yet: the trainer gets nothing from PT until you set it.
                  </p>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={shareSet ? "outline" : "default"}
                    onClick={() => setEditing(t)}
                  >
                    <Pencil /> PT share
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setApp(t.id)}>
                    <Smartphone /> Trainer app
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(t)}>
                    <Power /> {t.status === "active" ? "Stop PT" : "Take PT"}
                  </Button>
                  {!person && can("staff") ? (
                    <Button size="sm" variant="ghost" onClick={() => void addToStaff(t)}>
                      <UserPlus /> Add to Staff
                    </Button>
                  ) : null}
                  {!person && bin.canDelete("packages") ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => setDeleting(t)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <TrainerDialog
        item={editing}
        staff={editing ? staffOfTrainer(editing, staff.data) : null}
        onClose={() => setEditing(null)}
      />
      <StaffDialog
        item={adding ? "new" : null}
        presetRole="Trainer"
        onClose={() => setAdding(false)}
        onCreated={(id) => setShareNext(id)}
      />
      <TrainerAppDialog trainer={appTrainer} onClose={() => setApp(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete trainer ${deleting?.name ?? ""}?`}
        description="Their trainer app stops working. Their PT plans and payouts stay as they are. The trainer waits in the Recycle Bin, where they can be restored."
        confirmLabel="Delete trainer"
        destructive
        onConfirm={() => {
          const t = deleting;
          setDeleting(null);
          if (t) void bin.remove(`Trainer ${t.name}`, (by) => binTrainer(t, by));
        }}
      />
    </div>
  );
}

/**
 * A trainer's PT share and details. For a trainer on the Staff page, name, phone and joining
 * date come from there (edited on the Staff page); only PT things are set here.
 */
function TrainerDialog({
  item,
  staff,
  onClose,
}: {
  item: Trainer | null;
  staff: Staff | null;
  onClose: () => void;
}) {
  const [f, setF] = useState<TrainerInput | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (item) {
      setF(strip(item));
      setErr("");
    }
  }, [item]);
  const save = async () => {
    if (!item || !f) return;
    if (!staff && f.name.trim().length < 2) return setErr("Name is required");
    if (
      f.defaultTrainerShare < 0 ||
      (f.defaultShareType === "percentage" && f.defaultTrainerShare > 100)
    )
      return setErr("Share percentage must be 0–100");
    try {
      await saveTrainer({ ...f, name: f.name.trim() }, item.id);
      toast.success("Trainer saved");
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <FormDialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={`PT share · ${item?.name ?? ""}`}
      description={
        staff
          ? "Name, phone and joining date come from the Staff page."
          : "This trainer is not on the Staff page yet."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save()}>Save</Button>
        </>
      }
    >
      {f ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {err ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {err}
            </p>
          ) : null}
          {staff ? null : (
            <>
              <Field label="Name" htmlFor="t-name" required>
                <Input
                  id="t-name"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </Field>
              <Field label="Phone" htmlFor="t-phone">
                <Input
                  id="t-phone"
                  value={f.phone}
                  onChange={(e) => setF({ ...f, phone: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="Share type" htmlFor="t-stype">
            <Select
              value={f.defaultShareType}
              onValueChange={(v) => setF({ ...f, defaultShareType: v as ShareType })}
            >
              <SelectTrigger id="t-stype" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage of the PT price</SelectItem>
                <SelectItem value="fixed">Fixed ₹ per PT plan</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={f.defaultShareType === "percentage" ? "Trainer share %" : "Trainer share ₹"}
            htmlFor="t-sval"
            hint={(() => {
              const ex = calculateShare(5000, f.defaultShareType, f.defaultTrainerShare);
              return `On ₹5,000 PT: trainer ${formatPrice(ex.trainerShareAmount)}, gym ${formatPrice(ex.gymShareAmount)}`;
            })()}
          >
            <Input
              id="t-sval"
              type="number"
              min={0}
              value={f.defaultTrainerShare}
              onChange={(e) => setF({ ...f, defaultTrainerShare: Number(e.target.value) })}
            />
          </Field>
          <Field label="Specialization" htmlFor="t-spec">
            <Input
              id="t-spec"
              value={f.specialization}
              placeholder="e.g. Strength, weight loss"
              onChange={(e) => setF({ ...f, specialization: e.target.value })}
            />
          </Field>
          <Field label="Email" htmlFor="t-email">
            <Input
              id="t-email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="Notes" htmlFor="t-notes" className="sm:col-span-2">
            <Textarea
              id="t-notes"
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </FormDialog>
  );
}
