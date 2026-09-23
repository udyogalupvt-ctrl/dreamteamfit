import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CalendarRange, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLive } from "@/hooks/use-live-query";
import {
  MEMBERSHIP_STATUS_META,
  formatDateISO,
  formatDuration,
  formatPrice,
  todayISO,
} from "@/lib/format";
import { subscribePackages } from "@/services/packages.service";
import {
  calculateEndDate,
  createMembership,
  type PreviousAction,
} from "@/services/memberships.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { GymPackage, Membership } from "@/types/models";

export function AddMembershipDialog({
  open,
  onOpenChange,
  clientId,
  activeMembership,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  activeMembership: Membership | null;
}) {
  const { data: packages, loading } = useLive<GymPackage[]>(open ? subscribePackages : null, [], [open]);
  const active = packages.filter((p) => p.isActive);
  const [packageId, setPackageId] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [previousAction, setPreviousAction] = useState<PreviousAction>("expired");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate=useNavigate();

  useEffect(() => {
    if (open) {
      setPackageId("");
      setStartDate(todayISO());
      setPreviousAction("expired");
      setError(null);
    }
  }, [open]);

  const pkg = active.find((p) => p.id === packageId) ?? null;
  const endDate = useMemo(
    () => (pkg && startDate ? calculateEndDate(startDate, pkg.durationDays) : null),
    [pkg, startDate],
  );
  const status = startDate > todayISO() ? "pending" : "active";

  const submit = async () => {
    if (!pkg) return setError("Select a package");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return setError("Choose a valid start date");
    setError(null);
    setSaving(true);
    try {
      await createMembership({ clientId, pkg, startDate, previousAction });
      toast.success("Membership added", {
        description: `${pkg.name} · ${formatDateISO(startDate)} → ${formatDateISO(endDate)}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add membership"
      description="Pick a package and start date — the end date is calculated for you."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !pkg}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Confirm membership
          </Button>
          <Button variant="secondary" onClick={()=>{onOpenChange(false);void navigate({to:"/billing",search:{create:true,clientId}})}} disabled={saving}>
            Generate invoice instead
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {!loading && active.length === 0 ? (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold">No active packages</p>
            <p className="mt-1 text-muted-foreground">
              Create or activate a package first.{" "}
              <Link to="/packages" className="font-medium text-foreground underline underline-offset-2">
                Go to Packages
              </Link>
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Package" htmlFor="m-package" error={error ?? undefined} required>
            <Select value={packageId} onValueChange={setPackageId} disabled={loading || !active.length}>
              <SelectTrigger id="m-package" className="h-10 w-full">
                <SelectValue placeholder={loading ? "Loading packages…" : "Select a package"} />
              </SelectTrigger>
              <SelectContent>
                {active.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {formatPrice(p.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start date" htmlFor="m-start" required>
            <Input id="m-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <div className="flex items-center gap-2">
            <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-card-title">Summary</p>
          </div>
          {pkg && endDate ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-meta">Package</dt>
                <dd className="font-semibold">{pkg.name}</dd>
                <dd className="text-meta">{formatDuration(pkg.durationDays)} ({pkg.durationDays} days)</dd>
              </div>
              <div>
                <dt className="text-meta">Price</dt>
                <dd className="font-display text-xl font-extrabold tabular-nums">{formatPrice(pkg.price)}</dd>
              </div>
              <div>
                <dt className="text-meta">Start</dt>
                <dd className="font-semibold">{formatDateISO(startDate)}</dd>
              </div>
              <div>
                <dt className="text-meta">End (auto)</dt>
                <dd className="font-semibold">{formatDateISO(endDate)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-meta mb-1">Status</dt>
                <dd>
                  <StatusPill tone={MEMBERSHIP_STATUS_META[status].tone}>
                    {MEMBERSHIP_STATUS_META[status].label}
                  </StatusPill>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-meta mt-2">Select a package to see dates and price.</p>
          )}
        </div>

        {activeMembership && status === "active" ? (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 text-warning" aria-hidden />
              {activeMembership.packageNameSnapshot} is currently active
            </p>
            <p className="mt-1 text-muted-foreground">
              It stays in history. How should it be closed?
            </p>
            <RadioGroup
              value={previousAction}
              onValueChange={(v) => setPreviousAction(v as PreviousAction)}
              className="mt-3 grid gap-2 sm:grid-cols-2"
            >
              {(
                [
                  ["expired", "Mark as expired"],
                  ["cancelled", "Mark as cancelled"],
                ] as const
              ).map(([v, l]) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5"
                >
                  <RadioGroupItem value={v} /> {l}
                </label>
              ))}
            </RadioGroup>
          </div>
        ) : null}
      </div>
    </FormDialog>
  );
}
