import { useEffect, useState } from "react";
import { Ban, Dumbbell, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Field, FormDialog } from "@/components/common/form-dialog";
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
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { effectiveMembershipStatus, formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { subscribeDevices } from "@/services/biometric-devices.service";
import { cancelPtAssignment, endAllPlans } from "@/services/end-plans.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeClientPtAssignments } from "@/services/pt.service";
import {
  PAYMENT_METHODS,
  type BiometricDevice,
  type Client,
  type Invoice,
  type Membership,
  type PaymentMethod,
  type PtAssignment,
} from "@/types/models";

/** A PT plan is running or waiting to start (can still be cancelled). */
const ptOpen = (p: PtAssignment) =>
  (p.status === "active" || p.status === "pending") && p.endDate >= todayISO();
const PT_LABEL: Record<string, { label: string; tone: "success" | "info" | "warning" | "danger" }> =
  {
    active: { label: "Running", tone: "success" },
    pending: { label: "Starts later", tone: "info" },
    completed: { label: "Ended", tone: "warning" },
    cancelled: { label: "Cancelled", tone: "danger" },
  };

/** Plan tab: the member's PT plans next to their gym plans, each running one can be cancelled. */
export function ClientPtPlans({ client }: { client: Client }) {
  const pts = useLive<PtAssignment[]>(
    (ok, fail) => subscribeClientPtAssignments(client.id, ok, fail),
    [],
    [client.id],
  );
  const [cancelling, setCancelling] = useState<PtAssignment | null>(null);
  if (!pts.data.length) return null;
  const confirm = async () => {
    const p = cancelling;
    setCancelling(null);
    if (!p) return;
    try {
      await cancelPtAssignment(p);
      toast.success("PT plan cancelled", { description: p.ptPackageNameSnapshot });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <section className="surface-card overflow-hidden">
      <h2 className="text-section-title flex items-center gap-2 border-b border-border p-5">
        <Dumbbell className="size-4" aria-hidden /> PT plans
      </h2>
      <ul className="divide-y divide-border">
        {pts.data.map((p) => {
          const shown = p.status === "active" && p.endDate < todayISO() ? "completed" : p.status;
          const meta = PT_LABEL[shown] ?? { label: shown, tone: "info" as const };
          return (
            <li
              key={p.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.ptPackageNameSnapshot}</p>
                <p className="text-meta">
                  With {p.trainerNameSnapshot} · {formatDateISO(p.startDate)} →{" "}
                  {formatDateISO(p.endDate)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="font-semibold tabular-nums">{formatPrice(p.ptPrice)}</span>
                <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                {ptOpen(p) ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Cancel ${p.ptPackageNameSnapshot}`}
                    onClick={() => setCancelling(p)}
                  >
                    <XCircle aria-hidden />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.ptPackageNameSnapshot ?? "PT plan"}?`}
        description="The PT plan is marked cancelled (it stays in history). If the member has no other running plan, their thumb stops opening the door."
        confirmLabel="Cancel PT plan"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => void confirm()}
      />
    </section>
  );
}

/**
 * Owner only: "End all plans & stop entry" for a member who is leaving (moved to another town,
 * stopped…): every running / upcoming gym and PT plan is cancelled today, the door stops opening
 * for them, and money given back is recorded as a refund.
 */
export function EndAllPlansButton({
  client,
  memberships,
  invoices,
}: {
  client: Client;
  memberships: Membership[];
  invoices: Invoice[];
}) {
  const { owner } = useAccess();
  const { user } = useAuth();
  const pts = useLive<PtAssignment[]>(
    (ok, fail) => subscribeClientPtAssignments(client.id, ok, fail),
    [],
    [client.id],
  );
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setReason("");
    setRefund("");
    setMethod("Cash");
    setError("");
  }, [open]);

  const plans = memberships.filter((m) =>
    ["active", "pending"].includes(effectiveMembershipStatus(m)),
  );
  const openPts = pts.data.filter(ptOpen);
  if (!owner || (!plans.length && !openPts.length)) return null;

  const device = devices.data.find((d) => d.id === client.biometricDeviceId);
  const latestBill =
    [...invoices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const paidTotal = invoices.reduce((n, i) => n + i.amountPaid, 0);

  const submit = async () => {
    const amount = refund.trim() === "" ? 0 : Number(refund);
    if (!Number.isFinite(amount) || amount < 0)
      return setError("Enter the refund in rupees, or leave it empty.");
    if (amount > paidTotal && paidTotal > 0)
      return setError(`More than they paid (${formatPrice(paidTotal)}).`);
    setError("");
    try {
      const r = await endAllPlans({
        client,
        plans,
        pts: openPts,
        latestBill: latestBill
          ? { id: latestBill.id, invoiceNumber: latestBill.invoiceNumber }
          : null,
        reason,
        refund: amount,
        refundMethod: method,
        by: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Owner" },
      });
      toast.success(`${r.plans} plan${r.plans === 1 ? "" : "s"} ended`, {
        description: r.refund
          ? `Refund ${formatPrice(r.refund)} recorded as money given back.`
          : undefined,
      });
      setOpen(false);
    } catch (e) {
      setError(firestoreErrorMessage(e));
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="border-destructive/50 text-destructive"
        onClick={() => setOpen(true)}
      >
        <Ban aria-hidden /> End all plans & stop entry
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="End all plans & stop entry"
        description={`For a member who is leaving. Everything below is cancelled today for ${client.fullName}.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep plans
            </Button>
            <Button variant="destructive" onClick={() => submit()}>
              <Ban aria-hidden /> End all plans
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {plans.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 p-3">
                <span className="min-w-0">
                  <b>{m.packageNameSnapshot}</b>
                  <span className="text-meta block">
                    {formatDateISO(m.startDate)} → {formatDateISO(m.endDate)}
                  </span>
                </span>
                <span className="tabular-nums">{formatPrice(m.priceSnapshot)}</span>
              </li>
            ))}
            {openPts.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 p-3">
                <span className="min-w-0">
                  <b>PT: {p.ptPackageNameSnapshot}</b>
                  <span className="text-meta block">
                    With {p.trainerNameSnapshot} · {formatDateISO(p.startDate)} →{" "}
                    {formatDateISO(p.endDate)}
                  </span>
                </span>
                <span className="tabular-nums">{formatPrice(p.ptPrice)}</span>
              </li>
            ))}
          </ul>
          <Field
            label="Reason"
            htmlFor="end-reason"
            hint="Kept with the plans and in the activity log."
          >
            <Input
              id="end-reason"
              placeholder="e.g. Moved to another town"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Refund given back ₹"
              htmlFor="end-refund"
              hint={`Empty = no refund. They paid ${formatPrice(paidTotal)} in all.`}
            >
              <Input
                id="end-refund"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder="0"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
              />
            </Field>
            <Field label="Given back by" htmlFor="end-method">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="end-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="rounded-xl bg-muted p-3 text-sm">
            {!client.firstThumbRegistered
              ? "No thumb registered, so nothing changes on the fingerprint machine."
              : device && !device.doorControl
                ? "Door control is off on the machine: their thumb still opens the door. Turn on Door control (Fingerprint Devices), or use Block entry on the profile."
                : "Their thumb stops opening the door within about a minute. Their fingerprint is kept, so if they come back and pay, they get in again without a new scan."}
          </p>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </FormDialog>
    </>
  );
}
