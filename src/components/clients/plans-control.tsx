import { useEffect, useState } from "react";
import { Ban, Dumbbell, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EditLines } from "@/components/billing/edit-payment-dialog";
import { EditPtDialog } from "@/components/clients/edit-pt-dialog";
import { RemovePlanDialog, type RemoveTarget } from "@/components/clients/remove-plan-dialog";
import { PlanPriceAmount } from "@/components/clients/plan-price";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { subscribeClientPayments } from "@/services/finance.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  cancelPlans,
  paidForPlans,
  refundPlans,
  restoreCancellation,
  splitRefund,
} from "@/services/plan-cancel.service";
import { refundLimit } from "@/lib/plan-money";
import { subscribeClientPtAssignments } from "@/services/pt.service";
import {
  PAYMENT_METHODS,
  type BiometricDevice,
  type Client,
  type Invoice,
  type Membership,
  type Payment,
  type PaymentMethod,
  type PtAssignment,
} from "@/types/models";

/** A PT plan is running or waiting to start (can still be cancelled). */
const ptOpen = (p: PtAssignment) =>
  (p.status === "active" || p.status === "pending") && p.endDate >= todayISO();
/** A cancelled plan whose dates aren't over yet can be put back. */
const canRestore = (p: { status: string; endDate: string }) =>
  p.status === "cancelled" && p.endDate >= todayISO();
const PT_LABEL: Record<string, { label: string; tone: "success" | "info" | "warning" | "danger" }> =
  {
    active: { label: "Running", tone: "success" },
    pending: { label: "Starts later", tone: "info" },
    completed: { label: "Ended", tone: "warning" },
    cancelled: { label: "Cancelled", tone: "danger" },
  };

/** "Cancelled 1 Oct 2026 · Moved to another town" under a cancelled plan. */
export function CancelNote({ plan }: { plan: { cancelledOn?: string; cancelReason?: string } }) {
  if (!plan.cancelledOn && !plan.cancelReason) return null;
  return (
    <p className="text-meta">
      Cancelled{plan.cancelledOn ? ` ${formatDateISO(plan.cancelledOn)}` : ""}
      {plan.cancelReason ? ` · ${plan.cancelReason}` : ""}
    </p>
  );
}

/**
 * Cancelling one gym plan, one PT plan, or all of a member's plans ("End all plans"): an
 * optional reason and refund (money given back), then Undo on the message.
 */
export function CancelPlansDialog({
  client,
  plans,
  pts,
  invoices,
  all = false,
  open,
  onOpenChange,
}: {
  client: Client;
  plans: Membership[];
  pts: PtAssignment[];
  invoices: Invoice[];
  /** "End all plans & stop entry" (owner). */
  all?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can, canDelete } = useAccess();
  const { user } = useAuth();
  // Refunds change the money and trainer payouts: Finance (the owner has it).
  const money = can("finance");
  // Read only while the box is open (the member page keeps up to three of these closed).
  const devices = useLive<BiometricDevice[]>(open ? subscribeDevices : null, [], [open]);
  // Refunds already given (minus payments), so a second refund can't go past what they paid.
  const pays = useLive<Payment[]>(
    open ? (ok, fail) => subscribeClientPayments(client.id, ok, fail) : null,
    [],
    [open, client.id],
  );
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [stopDue, setStopDue] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setReason("");
    setRefund("");
    setMethod("Cash");
    setStopDue(true);
    setError("");
  }, [open]);

  const device = devices.data.find((d) => d.id === client.biometricDeviceId);
  const latestBill =
    [...invoices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const count = plans.length + pts.length;
  const one = plans[0]?.packageNameSnapshot ?? pts[0]?.ptPackageNameSnapshot ?? "plan";
  const these = count > 1 ? "these plans" : "this plan";
  const ids = new Set([...plans.map((m) => m.id), ...pts.map((p) => p.id)]);
  const ofThese = (x: { membershipId: string | null; ptAssignmentId: string | null }) =>
    (!!x.membershipId && ids.has(x.membershipId)) ||
    (!!x.ptAssignmentId && ids.has(x.ptAssignmentId));
  // The most that can be given back: what was paid for these plans here (their bills, after any
  // discount) and in the old software, less refunds already given for them.
  const paid = paidForPlans(invoices, plans, pts);
  const theirBills = invoices.filter(ofThese);
  const discount = theirBills.reduce((n, i) => n + Math.max(0, i.discount), 0);
  const limit = refundLimit(refundPlans(plans, pts), invoices, pays.data);
  const refundedBefore = limit.refunded;
  const maxRefund = limit.max;
  const limitNotes = [
    limit.old ? `${formatPrice(limit.old)} paid in the old software` : "",
    refundedBefore ? `${formatPrice(refundedBefore)} already refunded` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const amount = refund.trim() === "" ? 0 : Number(refund);
  const parts = Number.isFinite(amount) && amount > 0 ? splitRefund(amount, plans, pts, paid) : [];
  const cuts = parts.filter((p) => p.trainerCut > 0);
  // Bills of only these plans with money still due: asked for daily unless it's dropped.
  const dueBills = invoices.filter(
    (i) =>
      i.balanceDue > 0 &&
      i.paymentStatus !== "refunded" &&
      !!(i.membershipId || i.ptAssignmentId) &&
      (!i.membershipId || ids.has(i.membershipId)) &&
      (!i.ptAssignmentId || ids.has(i.ptAssignmentId)),
  );
  const dueTotal = dueBills.reduce((n, i) => n + i.balanceDue, 0);

  const submit = async () => {
    if (!Number.isFinite(amount) || amount < 0)
      return setError("Enter the refund in rupees, or leave it empty.");
    // The cap counts refunds already given: wait for them.
    if (amount > 0 && pays.loading) return setError("Still loading their payments: try again.");
    if (amount > 0 && amount > maxRefund)
      return setError(
        maxRefund
          ? `More than they paid for ${these} (${formatPrice(maxRefund)}).`
          : refundedBefore
            ? "Everything they paid has been refunded already."
            : `Nothing was paid for ${these} here or in the old software.`,
      );
    setError("");
    try {
      const r = await cancelPlans({
        client,
        plans,
        pts,
        latestBill: latestBill
          ? { id: latestBill.id, invoiceNumber: latestBill.invoiceNumber }
          : null,
        reason,
        refund: money ? amount : 0,
        refundMethod: method,
        paid,
        closeBills: stopDue ? dueBills : [],
        by: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Staff" },
      });
      onOpenChange(false);
      const first = plans[0]
        ? { kind: "gym" as const, plan: { ...plans[0], cancelId: r.cancelId } }
        : { kind: "pt" as const, plan: { ...pts[0]!, cancelId: r.cancelId } };
      toast.success(all ? `${r.plans} plan${r.plans === 1 ? "" : "s"} ended` : `${one} cancelled`, {
        description:
          [
            r.refund ? `Refund ${formatPrice(r.refund)} recorded as money given back.` : "",
            stopDue && dueTotal ? `${formatPrice(dueTotal)} due is no longer asked for.` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        duration: 12000,
        action: {
          label: "Undo",
          onClick: () =>
            void restoreCancellation(client, first).then(
              () => toast.success("Undone: plans are back"),
              (e: unknown) => toast.error(firestoreErrorMessage(e)),
            ),
        },
      });
    } catch (e) {
      setError(firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={all ? "End all plans & stop entry" : `Cancel ${one}?`}
      description={
        all
          ? `For a member who is leaving. Everything below is cancelled today for ${client.fullName}.`
          : "It is marked cancelled and stays in the history. You can restore it later."
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep {count > 1 ? "plans" : "plan"}
          </Button>
          <Button variant="destructive" onClick={() => submit()}>
            <Ban aria-hidden /> {all ? "End all plans" : "Cancel plan"}
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
          {pts.map((p) => (
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
          {theirBills.length || limit.old ? (
            <li className="flex justify-between gap-3 bg-muted/50 p-3">
              <span className="min-w-0">
                <b>Paid for {these}</b>
                {discount ? (
                  <span className="text-meta block">
                    after the {formatPrice(discount)} discount on the bill
                  </span>
                ) : null}
                {limit.old ? (
                  <span className="text-meta block">
                    {formatPrice(limit.old)} of it in the old software
                  </span>
                ) : null}
              </span>
              <b className="tabular-nums">{formatPrice(limit.here + limit.old)}</b>
            </li>
          ) : null}
        </ul>
        {all ? null : (
          <p className="text-meta">
            Added by mistake? Don't cancel:{" "}
            {canDelete("plans") ? "use Remove (bin icon)" : "ask the owner to remove it"} — it takes
            the plan and its money out as if it was never added.
          </p>
        )}
        <Field label="Reason (optional)" htmlFor="cancel-reason">
          <Input
            id="cancel-reason"
            placeholder="e.g. Moved to another town"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {money ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Refund given back ₹ (optional)"
              htmlFor="cancel-refund"
              hint={`Empty = no refund. Up to ${formatPrice(maxRefund)}${limitNotes ? ` (${limitNotes})` : ""}.`}
            >
              <Input
                id="cancel-refund"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder="0"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
              />
              {maxRefund > 0 ? (
                <button
                  type="button"
                  className="cursor-pointer justify-self-start text-sm font-semibold underline underline-offset-2"
                  onClick={() => setRefund(String(maxRefund))}
                >
                  Give back all {formatPrice(maxRefund)}
                </button>
              ) : null}
            </Field>
            <Field label="Given back by" htmlFor="cancel-method">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="cancel-method" className="w-full">
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
        ) : null}
        {dueTotal > 0 ? (
          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <Checkbox
              id="cancel-stop-due"
              checked={stopDue}
              onCheckedChange={(v) => setStopDue(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold">
                Stop asking for the {formatPrice(dueTotal)} still due
              </span>
              <span className="text-meta">
                Bill {dueBills.map((i) => i.invoiceNumber).join(", ")} shows Closed and no more
                balance reminders go out. Untick to keep asking for it.
              </span>
            </span>
          </label>
        ) : null}
        {cuts.length ? (
          <p className="rounded-xl bg-info/10 p-3 text-sm">
            {cuts.map((c) => (
              <span key={c.id} className="block">
                Trainer {c.trainerName}'s share goes down by <b>{formatPrice(c.trainerCut)}</b>{" "}
                (automatically: from their unpaid share, or off their next payout if already paid).
              </span>
            ))}
          </p>
        ) : null}
        <p className="rounded-xl bg-muted p-3 text-sm">
          {!client.firstThumbRegistered
            ? "No thumb registered, so nothing changes on the fingerprint machine."
            : device && !device.doorControl
              ? "Door control is off on the machine: their thumb still opens the door. Turn on Door control (Fingerprint Devices), or use Block entry on the profile."
              : "If they have no other running plan, their thumb stops opening the door within about a minute. Their fingerprint is kept: a restore or a new payment lets them in again without a new scan."}
        </p>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

/** "Restore" on a cancelled plan: it runs again, and anything cancelled with it comes back. */
export function RestorePlanButton({
  client,
  kind,
  plan,
}: {
  client: Client;
  kind: "gym" | "pt";
  plan: Membership | PtAssignment;
}) {
  const [open, setOpen] = useState(false);
  if (!canRestore(plan)) return null;
  const name =
    kind === "gym"
      ? (plan as Membership).packageNameSnapshot
      : (plan as PtAssignment).ptPackageNameSnapshot;
  const restore = async () => {
    setOpen(false);
    try {
      const r = await restoreCancellation(client, { kind, plan });
      toast.success(r.plans > 1 ? `${r.plans} plans restored` : `${name} restored`, {
        description:
          client.biometricStatus === "disabled"
            ? "Entry is still blocked for this member: press Allow entry on the Profile."
            : "They can come in again (the machine is updated at its next check-in).",
      });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden /> Restore
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Restore ${name}?`}
        description={`It runs again until ${formatDateISO(plan.endDate)}.${plan.cancelId ? " Anything cancelled together with it comes back too: a refund recorded with it is removed and a balance that was dropped is asked for again." : ""}`}
        confirmLabel="Restore"
        cancelLabel="Keep cancelled"
        onConfirm={() => void restore()}
      />
    </>
  );
}

/** Plan tab: the member's PT plans next to their gym plans: cancel a running one, restore. */
export function ClientPtPlans({ client, invoices }: { client: Client; invoices: Invoice[] }) {
  const pts = useLive<PtAssignment[]>(
    (ok, fail) => subscribeClientPtAssignments(client.id, ok, fail),
    [],
    [client.id],
  );
  const [cancelling, setCancelling] = useState<PtAssignment | null>(null);
  const [editing, setEditing] = useState<PtAssignment | null>(null);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const { can, canDelete } = useAccess();
  if (!pts.data.length) return null;
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
                {p.paidInOldSoftware ? (
                  <p className="text-meta">
                    Paid in the old software
                    {p.oldSoftwarePaid ? ` · ${formatPrice(p.oldSoftwarePaid)}` : ""}
                    {p.oldSoftwareBillNo ? ` · bill ${p.oldSoftwareBillNo}` : ""}
                  </p>
                ) : null}
                {p.status === "cancelled" ? <CancelNote plan={p} /> : null}
                <EditLines edits={p.edits} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                {p.paidInOldSoftware && p.oldSoftwarePaid ? (
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">
                      {formatPrice(p.oldSoftwarePaid)}
                    </span>
                    <span className="text-meta block tabular-nums">
                      paid there · package {formatPrice(p.ptPrice)}
                    </span>
                  </span>
                ) : (
                  <PlanPriceAmount
                    kind="pt"
                    price={p.ptPrice}
                    bill={
                      invoices.find(
                        (i) => (p.invoiceId && i.id === p.invoiceId) || i.ptAssignmentId === p.id,
                      ) ?? null
                    }
                  />
                )}
                <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                <RestorePlanButton client={client} kind="pt" plan={p} />
                {(ptOpen(p) || (p.paidInOldSoftware && p.status !== "cancelled")) &&
                can("members") ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${p.ptPackageNameSnapshot}`}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                ) : null}
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
                {canDelete("plans") && (ptOpen(p) || p.status === "cancelled") ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove PT: ${p.ptPackageNameSnapshot} (added by mistake)`}
                    title="Remove (added by mistake)"
                    onClick={() =>
                      setRemoving({
                        kind: "pt",
                        id: p.id,
                        name: `PT: ${p.ptPackageNameSnapshot}`,
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <EditPtDialog
        pt={editing}
        bill={
          editing
            ? (invoices.find(
                (i) =>
                  (editing.invoiceId && i.id === editing.invoiceId) ||
                  i.ptAssignmentId === editing.id,
              ) ?? null)
            : null
        }
        onClose={() => setEditing(null)}
      />
      <RemovePlanDialog client={client} target={removing} onClose={() => setRemoving(null)} />
      <CancelPlansDialog
        client={client}
        plans={[]}
        pts={cancelling ? [cancelling] : []}
        invoices={invoices}
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
      />
    </section>
  );
}

/**
 * Owner only: "End all plans & stop entry" for a member who is leaving (moved to another town,
 * stopped…): every running / upcoming gym and PT plan is cancelled today, with a refund if any.
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
  const pts = useLive<PtAssignment[]>(
    (ok, fail) => subscribeClientPtAssignments(client.id, ok, fail),
    [],
    [client.id],
  );
  const [open, setOpen] = useState(false);
  const plans = memberships.filter((m) =>
    ["active", "pending"].includes(effectiveMembershipStatus(m)),
  );
  const openPts = pts.data.filter(ptOpen);
  // Shown once the PT plans are in, so the box lists everything that will be ended.
  if (!owner || pts.loading || (!plans.length && !openPts.length)) return null;
  return (
    <>
      <Button
        variant="outline"
        className="border-destructive/50 text-destructive"
        onClick={() => setOpen(true)}
      >
        <Ban aria-hidden /> End all plans & stop entry
      </Button>
      <CancelPlansDialog
        client={client}
        plans={plans}
        pts={openPts}
        invoices={invoices}
        all
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
