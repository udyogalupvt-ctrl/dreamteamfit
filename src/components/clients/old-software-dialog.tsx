import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDateISO, formatPrice } from "@/lib/format";
import type { OldMember, OldPlan } from "@/lib/old-data";
import { toastWithUndo } from "@/lib/undo-toast";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { lookupOldMembers } from "@/services/old-data.service";
import {
  markPaidInOldSoftware,
  previewOldMove,
  undoOldSoftwareMove,
  type OldMovePlan,
} from "@/services/old-software.service";
import type { Invoice, Membership } from "@/types/models";

/** From the old software's records: its price for the plan, what was paid there, its bill no. */
export type OldSuggestion = { amount: number; paid: number; bill: string; plan?: string };

const paidOf = (p: Pick<OldPlan, "amount" | "balance">) =>
  Math.max(0, (p.amount || 0) - (p.balance || 0));

/** The old software's plan for the same days as this plan (the member's own record first). */
function matchOldPlan(members: OldMember[], oldMemberId: string, m: Membership) {
  const mine = members.find((x) => x.memberId && x.memberId === oldMemberId);
  const plans = (mine ? [mine] : members).flatMap((x) => x.plans);
  const days = (a: string, b: string) =>
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  return (
    plans
      .filter(
        (p) => p.start && p.end && p.start <= m.endDate && p.end >= m.startDate && p.amount > 0,
      )
      .sort((a, b) => days(a.start, m.startDate) - days(b.start, m.startDate))[0] ?? null
  );
}

/**
 * "Paid in the old software?": a plan entered here as a new sale although the member bought it in
 * the old software. The money comes off this app's collections (today's / this month's Collected,
 * Day Book, income, CFO, incentives). Two cases:
 * - the whole entry was a re-entry (usual): everything recorded here for the bill comes off, and
 *   the plan and bill become the old software's deal (its price, what was paid there);
 * - only part was paid there: just that part comes off, the rest stays as money paid here.
 */
export function OldSoftwareDialog({
  membership,
  bill,
  memberName,
  memberPhone,
  oldMemberId,
  suggested,
  onClose,
  onDone,
}: {
  membership: Membership | null;
  bill: Invoice | null;
  memberName: string;
  /** To find the member in the old software's records when no suggestion is given. */
  memberPhone?: string;
  oldMemberId?: string;
  suggested?: OldSuggestion | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const open = !!membership;
  const { can } = useAccess();
  const { user } = useAuth();
  const money = can("finance");
  const [mode, setMode] = useState<"whole" | "part">("whole");
  const [deal, setDeal] = useState("");
  const [paidThere, setPaidThere] = useState("");
  const [amount, setAmount] = useState("");
  const [billNo, setBillNo] = useState("");
  const [reason, setReason] = useState("");
  const [found, setFound] = useState<OldSuggestion | null>(null);
  const [plan, setPlan] = useState<OldMovePlan | null>(null);
  const [error, setError] = useState("");

  // What the old software says: given, or looked up by the member's phone.
  useEffect(() => {
    if (!membership) return;
    setFound(suggested ?? null);
    if (suggested || !memberPhone) return;
    let live = true;
    lookupOldMembers(memberPhone).then(
      (r) => {
        const p = live ? matchOldPlan(r.members, oldMemberId ?? "", membership) : null;
        if (p)
          setFound({
            amount: p.amount,
            paid: paidOf(p),
            bill: p.bill,
            plan: `${p.name} ${formatDateISO(p.start)} → ${formatDateISO(p.end)}`,
          });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [membership, suggested, memberPhone, oldMemberId]);

  useEffect(() => {
    if (!membership) return;
    setMode("whole");
    setDeal(found ? String(found.amount) : "");
    setPaidThere(found ? String(found.paid) : "");
    setAmount(String(Math.min(found?.paid || bill?.amountPaid || 0, bill?.amountPaid ?? 0) || ""));
    setBillNo(found?.bill ?? "");
    setReason("");
    setError("");
    setPlan(null);
  }, [membership, bill, found]);

  const value = Number(amount);
  const whole = mode === "whole" ? { deal: Number(deal), paid: Number(paidThere) } : null;
  const wholeKey = whole ? `${whole.deal}|${whole.paid}` : "";
  useEffect(() => {
    if (!membership) return;
    let live = true;
    const t = setTimeout(() => {
      previewOldMove(bill, Number.isFinite(value) ? value : 0, whole).then(
        (p) => live && setPlan(p),
        (e) => live && setError(firestoreErrorMessage(e)),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership, bill, value, wholeKey]);

  if (!membership) return null;
  const m = membership;
  const takenOff = plan ? plan.remove.reduce((n, p) => n + p.amount, 0) : 0;

  const save = async () => {
    setError("");
    try {
      const r = await markPaidInOldSoftware({
        membership: m,
        bill,
        amount: whole ? whole.paid : value,
        whole,
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
        whole
          ? `${formatPrice(takenOff)} taken off this app's money. Plan price is now ${formatPrice(whole.deal)}.`
          : `${formatPrice(value)} taken off this app's money (Collected, Day Book, income).`,
      );
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  const ready = whole ? whole.deal > 0 && whole.paid >= 0 : value > 0;
  const blocked = !money || !plan || !!plan.error || !ready;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Paid in the old software?"
      description={`${memberName} · ${m.packageNameSnapshot} · ${formatDateISO(m.startDate)} → ${formatDateISO(m.endDate)}. Use this when the plan was entered here as a new sale but the member bought it in the old software.`}
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
        {found?.plan || found ? (
          <p className="rounded-xl bg-info/10 p-3 text-sm">
            Old software: {found.plan ? `${found.plan}, ` : ""}price {formatPrice(found.amount)},
            paid <b>{formatPrice(found.paid)}</b>
            {found.bill ? ` (bill ${found.bill})` : ""}.
          </p>
        ) : null}
        {bill ? (
          <p className="rounded-xl bg-muted p-3 text-sm">
            Bill {bill.invoiceNumber} here: total {formatPrice(bill.total)}, recorded as paid here{" "}
            <b className="tabular-nums">{formatPrice(plan?.paidHere ?? bill.amountPaid)}</b>
            {bill.balanceDue > 0 ? `, ${formatPrice(bill.balanceDue)} owed` : ""}.
          </p>
        ) : null}

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as "whole" | "part")}
          className="grid gap-2"
          aria-label="What happened"
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm has-[button[data-state=checked]]:border-primary">
            <RadioGroupItem value="whole" id="old-whole" className="mt-0.5" disabled={!money} />
            <span>
              <span className="block font-semibold">The whole entry here was a mistake</span>
              <span className="text-meta">
                Everything recorded here for this bill (gym and PT) comes off. The plan and bill
                become the old software's price and payment.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm has-[button[data-state=checked]]:border-primary">
            <RadioGroupItem value="part" id="old-part" className="mt-0.5" disabled={!money} />
            <span>
              <span className="block font-semibold">Only part was paid there</span>
              <span className="text-meta">The rest really came in here and stays counted.</span>
            </span>
          </label>
        </RadioGroup>

        {mode === "whole" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Old software price ₹" htmlFor="old-deal">
              <Input
                id="old-deal"
                type="number"
                inputMode="decimal"
                min={0}
                value={deal}
                disabled={!money}
                onChange={(e) => setDeal(e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Paid there ₹"
              htmlFor="old-paid"
              hint={
                whole && whole.deal > whole.paid
                  ? `${formatPrice(whole.deal - whole.paid)} stays owed here`
                  : undefined
              }
            >
              <Input
                id="old-paid"
                type="number"
                inputMode="decimal"
                min={0}
                value={paidThere}
                disabled={!money}
                onChange={(e) => setPaidThere(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>
        ) : (
          <Field
            label="Paid in the old software ₹"
            htmlFor="old-amount"
            hint="The part of the money here that was really paid there."
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
        )}
        <Field label="Old software bill no. (optional)" htmlFor="old-bill">
          <Input
            id="old-bill"
            maxLength={40}
            value={billNo}
            disabled={!money}
            onChange={(e) => setBillNo(e.target.value)}
          />
        </Field>

        {bill && plan && !plan.error && ready ? (
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
              {whole ? (
                <>
                  <li>
                    Plan price {formatPrice(m.priceSnapshot)} → {formatPrice(whole.deal)}
                  </li>
                  <li>
                    Bill becomes one line: {formatPrice(whole.deal)}, "Paid in the old software"{" "}
                    {formatPrice(whole.paid)}, still owed {formatPrice(plan.after.balanceDue)}
                  </li>
                </>
              ) : (
                <li>
                  Bill total {formatPrice(bill.total)} → {formatPrice(plan.after.total)}, shows{" "}
                  {formatPrice(value)} "Paid in the old software"; still owed{" "}
                  {formatPrice(plan.after.balanceDue)}
                </li>
              )}
              {plan.cancelPayouts.length ? (
                <li>The trainer's PT share from this bill is cancelled (not earned here)</li>
              ) : null}
              <li>The plan's dates and the door stay as they are</li>
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
