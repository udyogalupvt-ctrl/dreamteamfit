import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { EditLines } from "@/components/billing/edit-payment-dialog";
import { Field, FormDialog } from "@/components/common/form-dialog";
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
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribePackages } from "@/services/packages.service";
import {
  billOfPlan,
  editMembership,
  pausedDays,
  previewPlanEdit,
  standardEnd,
} from "@/services/plan-edit.service";
import { staffDiscountOf } from "@/services/bill-edit.service";
import { subscribeStaff } from "@/services/staff.service";
import {
  PAYMENT_METHODS,
  type Client,
  type GymPackage,
  type Invoice,
  type Membership,
  type PaymentMethod,
  type Staff,
} from "@/types/models";

const NONE = "__none";

/**
 * "Edit plan": correct a plan after it was sold (wrong package, start / end date, counsellor,
 * a discount forgotten or typed wrong). Shows what changes, and what happens to the bill, before
 * saving.
 */
export function EditPlanDialog({
  client,
  membership,
  memberships,
  invoices,
  onClose,
}: {
  client: Client;
  membership: Membership | null;
  /** The member's other plans, to warn about overlapping dates. */
  memberships: Membership[];
  invoices: Invoice[];
  onClose: () => void;
}) {
  const open = !!membership;
  const { can } = useAccess();
  const { user } = useAuth();
  // Read only while the box is open.
  const packages = useLive<GymPackage[]>(open ? subscribePackages : null, [], [open]);
  const staff = useLive<Staff[]>(open ? subscribeStaff : null, [], [open]);
  const settings = useLive(open ? subscribeBusinessSettings : null, DEFAULT_BILLING_SETTINGS, [
    open,
  ]);

  const [pkgId, setPkgId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [counsellorId, setCounsellorId] = useState("");
  /** Text, so the box can be empty while typing; "" = unchanged. */
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [payBy, setPayBy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!membership) return;
    setPkgId(membership.packageId);
    setStart(membership.startDate);
    setEnd(membership.endDate);
    setCounsellorId(membership.counsellorId);
    setDiscount("");
    setReason("");
    setMethod("Cash");
    setPayBy(todayISO());
    setError("");
  }, [membership]);

  // Packages on sale, plus the plan's own package even if it is no longer sold.
  const choices = useMemo(() => {
    if (!membership) return [];
    const own = {
      id: membership.packageId,
      name: membership.packageNameSnapshot,
      price: membership.priceSnapshot,
      durationDays: membership.durationDaysSnapshot,
    };
    const sold = packages.data
      .filter((p) => p.isActive && p.id !== membership.packageId)
      .map((p) => ({ id: p.id, name: p.name, price: p.price, durationDays: p.durationDays }));
    return [own, ...sold.sort((a, b) => a.durationDays - b.durationDays || a.price - b.price)];
  }, [membership, packages.data]);
  const counsellors = useMemo(() => {
    const active = staff.data.filter((s) => s.active);
    const marked = active.filter((s) => s.isCounsellor);
    const list = marked.length ? marked : active;
    // Keep the one on the plan selectable even if they left or aren't marked counsellor.
    if (membership?.counsellorId && !list.some((s) => s.id === membership.counsellorId))
      return [
        { id: membership.counsellorId, name: membership.counsellorName || "Earlier counsellor" },
        ...list,
      ];
    return list.map((s) => ({ id: s.id, name: s.name }));
  }, [staff.data, membership]);

  if (!membership) return null;
  const m = membership;
  const pkg = choices.find((p) => p.id === pkgId) ?? choices[0]!;
  const paused = pausedDays(m);
  const usual = start ? standardEnd(start, pkg.durationDays, paused) : "";
  const counsellor = counsellors.find((c) => c.id === counsellorId) ?? null;
  const bill = billOfPlan(m, invoices);
  const billDiscount = bill ? staffDiscountOf(bill) : 0;
  const discountValue = discount.trim() === "" ? undefined : Number(discount);
  const form = { pkg, startDate: start, endDate: end, counsellor, discount: discountValue };
  const preview = previewPlanEdit(m, form, bill, settings.data);
  const discountEditable =
    !!bill &&
    !m.paidInOldSoftware &&
    bill.paymentStatus !== "closed" &&
    bill.paymentStatus !== "refunded";
  const bc = preview.bill;
  const money = can("finance");
  const extraDays =
    usual && end
      ? Math.round(
          (new Date(`${end}T00:00:00`).getTime() - new Date(`${usual}T00:00:00`).getTime()) /
            86_400_000,
        )
      : 0;
  const overlaps = memberships.filter(
    (o) =>
      o.id !== m.id &&
      ["active", "pending", "biometric_pending"].includes(o.status) &&
      o.startDate <= end &&
      o.endDate >= start,
  );

  // A new package or start date resets the end date to the usual one (staff can still change it).
  const changePackage = (id: string) => {
    setPkgId(id);
    const p = choices.find((c) => c.id === id);
    if (p && start) setEnd(standardEnd(start, p.durationDays, paused));
  };
  const changeStart = (v: string) => {
    setStart(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setEnd(standardEnd(v, pkg.durationDays, paused));
  };

  const save = async () => {
    setError("");
    try {
      await editMembership({
        client,
        membership: m,
        form,
        bill,
        settings: settings.data,
        reason,
        refundMethod: method,
        canRefund: money,
        nextPaymentDate: bc?.newBalance ? payBy : null,
        by: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Staff" },
      });
      onClose();
      toast.success("Plan updated", {
        description:
          [
            bc?.refund ? `${formatPrice(bc.refund)} recorded as money given back.` : "",
            bc && bc.balanceDue > 0 ? `Balance due ${formatPrice(bc.balanceDue)}.` : "",
          ]
            .filter(Boolean)
            .join(" ") || preview.changes.join(" · "),
      });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  const blocked =
    !!preview.error ||
    !preview.changes.length ||
    (preview.discountChanged && !money) ||
    !!(bc && bc.refund > 0 && !money) ||
    !!(bc?.newBalance && !payBy);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Edit plan"
      description={`Fix a wrong package, dates, discount or counsellor for ${client.fullName}. The same plan is changed; nothing is sold again.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save()} disabled={blocked}>
            <Pencil aria-hidden /> Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Package" htmlFor="plan-pkg">
          <Select value={pkg.id} onValueChange={changePackage}>
            <SelectTrigger id="plan-pkg" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.durationDays} days · {formatPrice(p.price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {discountEditable ? (
          <Field
            label="Discount (₹)"
            htmlFor="plan-discount"
            hint={
              !money
                ? "Only the owner's login (Income & expenses) can change a discount."
                : bill && bill.amountPaid > 0
                  ? "If they already paid more than the new total, the extra is recorded as money given back."
                  : `Package price ${formatPrice(pkg.price)}.`
            }
          >
            <Input
              id="plan-discount"
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              disabled={!money}
              placeholder={String(billDiscount)}
              value={discount === "" ? String(billDiscount) : discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="max-w-48 tabular-nums"
            />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="plan-start">
            <Input
              id="plan-start"
              type="date"
              value={start}
              onChange={(e) => changeStart(e.target.value)}
            />
          </Field>
          <Field
            label="End date"
            htmlFor="plan-end"
            hint={
              !usual
                ? undefined
                : extraDays === 0
                  ? `${pkg.durationDays} days${paused ? ` + ${paused} paused` : ""}`
                  : `${extraDays > 0 ? `${extraDays} extra` : `${-extraDays} fewer`} day${Math.abs(extraDays) === 1 ? "" : "s"} than usual (${formatDateISO(usual)})`
            }
          >
            <Input
              id="plan-end"
              type="date"
              min={start || undefined}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            {usual && extraDays !== 0 ? (
              <button
                type="button"
                className="cursor-pointer justify-self-start text-sm font-semibold underline underline-offset-2"
                onClick={() => setEnd(usual)}
              >
                Use {formatDateISO(usual)}
              </button>
            ) : null}
          </Field>
        </div>
        <Field label="Counsellor" htmlFor="plan-counsellor">
          <Select
            value={counsellorId || NONE}
            onValueChange={(v) => setCounsellorId(v === NONE ? "" : v)}
          >
            <SelectTrigger id="plan-counsellor" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No counsellor</SelectItem>
              {counsellors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {bc ? (
          <div className="grid gap-3 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">Bill {bc.bill.invoiceNumber}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
              {preview.discountChanged ? (
                <>
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd>
                    {formatPrice(billDiscount)} →{" "}
                    <b>{formatPrice(bc.discount - (bc.bill.upgradeCredit ?? 0))}</b>
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Total</dt>
              <dd>
                {formatPrice(bc.bill.total)} → <b>{formatPrice(bc.total)}</b>
              </dd>
              <dt className="text-muted-foreground">Paid</dt>
              <dd>{formatPrice(bc.bill.amountPaid)}</dd>
              <dt className="text-muted-foreground">Balance due</dt>
              <dd>
                {formatPrice(bc.bill.balanceDue)} → <b>{formatPrice(bc.balanceDue)}</b>
              </dd>
            </dl>
            {bc.refund > 0 ? (
              money ? (
                <div className="grid gap-2 rounded-lg bg-info/10 p-3">
                  <p>
                    They paid <b>{formatPrice(bc.refund)}</b> more than the new price. It is
                    recorded as money given back (Day Book shows it).
                  </p>
                  <Field label="Given back by" htmlFor="plan-refund-method">
                    <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                      <SelectTrigger id="plan-refund-method" className="w-full sm:w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((x) => (
                          <SelectItem key={x} value={x}>
                            {x}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              ) : (
                <p role="alert" className="rounded-lg bg-warning/15 p-3 font-medium">
                  They paid {formatPrice(bc.refund)} more than the new price. Giving money back
                  needs the owner's login (Income & expenses).
                </p>
              )
            ) : null}
            {bc.newBalance ? (
              <Field
                label="When will they pay the balance?"
                htmlFor="plan-pay-by"
                hint="The payment reminder goes out that morning."
              >
                <Input
                  id="plan-pay-by"
                  type="date"
                  min={todayISO()}
                  value={payBy}
                  onChange={(e) => setPayBy(e.target.value)}
                  className="max-w-48"
                />
              </Field>
            ) : null}
          </div>
        ) : preview.billNote ? (
          <p className="rounded-xl bg-muted p-3 text-sm">{preview.billNote}</p>
        ) : null}

        {overlaps.length ? (
          <p className="rounded-xl bg-warning/15 p-3 text-sm">
            These dates overlap{" "}
            {overlaps
              .map(
                (o) =>
                  `${o.packageNameSnapshot} (${formatDateISO(o.startDate)} → ${formatDateISO(o.endDate)})`,
              )
              .join(", ")}
            .
          </p>
        ) : null}

        <Field label="Why the change? (optional)" htmlFor="plan-reason">
          <Input
            id="plan-reason"
            placeholder="e.g. Picked the wrong package"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        {preview.changes.length ? (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="font-semibold">Will change</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {preview.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview.error || error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {preview.error || error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

/** The plan's corrections: the latest, and the earlier ones on request. */
export function PlanEdits({ plan }: { plan: Pick<Membership, "edits"> }) {
  return <EditLines edits={plan.edits} />;
}
