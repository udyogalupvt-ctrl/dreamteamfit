import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDateISO, formatPrice } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo-toast";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  markPaidInOldSoftware,
  previewOldMove,
  undoOldSoftwareMove,
  type OldMovePlan,
} from "@/services/old-software.service";
import type { Invoice, Membership } from "@/types/models";

/**
 * "Paid in the old software?": a plan entered here as a new sale although the member paid for it
 * in the old software. The money comes off this app's collections (today's / this month's
 * Collected, Day Book, income, CFO, incentives); the bill keeps its link and what is still owed.
 */
export function OldSoftwareDialog({
  membership,
  bill,
  memberName,
  suggested,
  onClose,
  onDone,
}: {
  membership: Membership | null;
  bill: Invoice | null;
  memberName: string;
  /** From the old software's records: what they paid there, and its bill number. */
  suggested?: { paid: number; bill: string } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const open = !!membership;
  const { can } = useAccess();
  const { user } = useAuth();
  const money = can("finance");
  const [amount, setAmount] = useState("");
  const [billNo, setBillNo] = useState("");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<OldMovePlan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!membership) return;
    setAmount(
      String(Math.min(suggested?.paid || bill?.amountPaid || 0, bill?.amountPaid ?? 0) || ""),
    );
    setBillNo(suggested?.bill ?? "");
    setReason("");
    setError("");
    setPlan(null);
  }, [membership, bill, suggested]);

  const value = Number(amount);
  useEffect(() => {
    if (!membership) return;
    let live = true;
    const t = setTimeout(() => {
      previewOldMove(bill, Number.isFinite(value) ? value : 0).then(
        (p) => live && setPlan(p),
        (e) => live && setError(firestoreErrorMessage(e)),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [membership, bill, value]);

  if (!membership) return null;
  const m = membership;

  const save = async () => {
    setError("");
    try {
      const r = await markPaidInOldSoftware({
        membership: m,
        bill,
        amount: value,
        billNo,
        reason,
        canFinance: money,
        by: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Staff" },
      });
      onClose();
      onDone?.();
      toastWithUndo(
        "Marked as paid in the old software",
        () => undoOldSoftwareMove(r.moveId, money),
        `${formatPrice(value)} taken off this app's money (Collected, Day Book, income).`,
      );
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  const blocked = !money || !plan || !!plan.error || !(value > 0);
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Paid in the old software?"
      description={`${memberName} · ${m.packageNameSnapshot} · ${formatDateISO(m.startDate)} → ${formatDateISO(m.endDate)}. Use this when the plan was entered here as a new sale but the member paid for it in the old software.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save()} disabled={blocked}>
            <History aria-hidden /> Mark as paid in the old software
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!money ? (
          <p role="alert" className="rounded-lg bg-warning/15 p-3 text-sm font-medium">
            This changes money: it needs the owner's login (Income & expenses).
          </p>
        ) : null}
        {bill ? (
          <p className="rounded-xl bg-muted p-3 text-sm">
            Bill {bill.invoiceNumber}: total {formatPrice(bill.total)}, recorded as paid here{" "}
            <b className="tabular-nums">{formatPrice(plan?.paidHere ?? bill.amountPaid)}</b>
            {bill.balanceDue > 0 ? `, ${formatPrice(bill.balanceDue)} still owed` : ""}.
          </p>
        ) : (
          <p className="rounded-xl bg-muted p-3 text-sm">
            No bill here for this plan: only the plan is marked.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Paid in the old software ₹"
            htmlFor="old-amount"
            hint={
              suggested?.paid
                ? `Old software: ${formatPrice(suggested.paid)}${suggested.bill ? ` (bill ${suggested.bill})` : ""}`
                : "The part of the money here that was really paid there."
            }
          >
            <Input
              id="old-amount"
              type="number"
              inputMode="decimal"
              min={0}
              value={amount}
              disabled={!money}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Old software bill no. (optional)" htmlFor="old-bill">
            <Input
              id="old-bill"
              maxLength={40}
              value={billNo}
              disabled={!money}
              onChange={(e) => setBillNo(e.target.value)}
            />
          </Field>
        </div>
        {bill && plan && !plan.error && value > 0 ? (
          <div className="grid gap-2 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">What changes</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {plan.remove.map((p) => (
                <li key={p.id}>
                  Payment of {formatDateISO(p.date)} ({formatPrice(p.amount)}) taken off this app's
                  money
                </li>
              ))}
              {plan.lower.map((p) => (
                <li key={p.id}>
                  Payment of {formatDateISO(p.date)} lowered {formatPrice(p.from)} →{" "}
                  {formatPrice(p.to)} (the rest was really paid here)
                </li>
              ))}
              <li>
                Bill total {formatPrice(bill.total)} → {formatPrice(plan.after.total)}, shows{" "}
                {formatPrice(value)} "Paid in the old software"; still owed{" "}
                {formatPrice(plan.after.balanceDue)}
              </li>
              {plan.cancelPayouts.length ? (
                <li>The trainer's PT share from this bill is cancelled (not earned here)</li>
              ) : null}
              <li>The plan, its dates and the door stay as they are</li>
            </ul>
          </div>
        ) : null}
        <Field label="Note (optional)" htmlFor="old-reason">
          <Input
            id="old-reason"
            maxLength={300}
            placeholder="e.g. Anniversary offer paid in the old software"
            value={reason}
            disabled={!money}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {plan?.error || error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {plan?.error || error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
