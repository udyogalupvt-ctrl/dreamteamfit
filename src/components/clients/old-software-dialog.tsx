import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  isOldPtPlan,
  markPaidInOldSoftware,
  previewOldMove,
  undoOldSoftwareMove,
  type OldDealLine,
  type OldMovePlan,
} from "@/services/old-software.service";
import type { Invoice, Membership } from "@/types/models";

const paidOf = (p: Pick<OldPlan, "amount" | "balance">) =>
  Math.max(0, (p.amount || 0) - (p.balance || 0));
const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const keyOf = (p: Pick<OldPlan, "name" | "start" | "end">) => `${p.name}|${p.start}|${p.end}`;

/**
 * The old plans this bill most likely covered: those starting within a week of this plan (a PT
 * plan only when the bill has PT). The owner can change the ticks.
 */
function preselect(plans: OldPlan[], m: Membership, billHasPt: boolean) {
  return new Set(
    plans
      .filter((p) => p.amount > 0 && p.start && dayGap(p.start, m.startDate) <= 7)
      .filter((p) => (isOldPtPlan(p.name) ? billHasPt : true))
      .map(keyOf),
  );
}

/**
 * "Paid in the old software?": a plan entered here as a new sale although the member bought it in
 * the old software. Shows the member's whole old-software record (every plan, price, what was paid)
 * so the owner decides with everything in view. Two cases:
 * - the whole entry here was a re-entry (usual): everything recorded here for the bill comes off,
 *   and the bill becomes the old plans it covered (ticked), the plan price the old gym plan's;
 * - only part was paid there: just that part comes off, the rest stays as money paid here.
 */
export function OldSoftwareDialog({
  membership,
  bill,
  memberName,
  memberPhone,
  oldMemberId,
  onClose,
  onDone,
}: {
  membership: Membership | null;
  bill: Invoice | null;
  memberName: string;
  /** To find the member in the old software's records. */
  memberPhone?: string | undefined;
  oldMemberId?: string | undefined;
  onClose: () => void;
  onDone?: () => void;
}) {
  const open = !!membership;
  const { can } = useAccess();
  const { user } = useAuth();
  const money = can("finance");
  const [mode, setMode] = useState<"whole" | "part">("whole");
  const [record, setRecord] = useState<OldMember | null>(null);
  const [looking, setLooking] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [deal, setDeal] = useState("");
  const [paidThere, setPaidThere] = useState("");
  const [amount, setAmount] = useState("");
  const [billNo, setBillNo] = useState("");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<OldMovePlan | null>(null);
  const [error, setError] = useState("");
  const billHasPt = !!(bill && (bill.ptAssignmentId || bill.ptGross > 0));

  // The member's old-software record (by phone; their linked old ID first).
  useEffect(() => {
    if (!membership) return;
    setRecord(null);
    setTicked(new Set());
    setMode("whole");
    setDeal("");
    setPaidThere("");
    setAmount(String(bill?.amountPaid || ""));
    setBillNo("");
    setReason("");
    setError("");
    setPlan(null);
    if (!memberPhone) return;
    let live = true;
    setLooking(true);
    lookupOldMembers(memberPhone)
      .then(
        (r) => {
          if (!live) return;
          const person =
            r.members.find((x) => x.memberId && x.memberId === oldMemberId) ??
            (r.members.length === 1 ? r.members[0]! : null) ??
            r.members.find((x) =>
              x.plans.some((p) => p.start && dayGap(p.start, membership.startDate) <= 7),
            ) ??
            null;
          setRecord(person);
          if (person) {
            const pre = preselect(person.plans, membership, billHasPt);
            setTicked(pre);
            const first = person.plans.find((p) => pre.has(keyOf(p)) && p.bill);
            setBillNo(first?.bill ?? "");
          }
        },
        () => undefined,
      )
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
  }, [membership, bill, memberPhone, oldMemberId, billHasPt]);

  const lines: OldDealLine[] = useMemo(
    () =>
      (record?.plans ?? [])
        .filter((p) => ticked.has(keyOf(p)))
        .map((p) => ({
          name: p.name,
          start: p.start,
          end: p.end,
          amount: p.amount,
          paid: paidOf(p),
          bill: p.bill,
        })),
    [record, ticked],
  );
  const fromRecord = !!record && lines.length > 0;
  const whole =
    mode === "whole"
      ? fromRecord
        ? {
            deal: lines.reduce((n, l) => n + l.amount, 0),
            paid: lines.reduce((n, l) => n + l.paid, 0),
            lines,
          }
        : { deal: Number(deal), paid: Number(paidThere) }
      : null;
  const value = Number(amount);
  const wholeKey = whole ? `${whole.deal}|${whole.paid}|${lines.length}` : "";
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
  const gymLines = lines.filter((l) => !isOldPtPlan(l.name));
  const newPrice = whole
    ? gymLines.length
      ? gymLines.reduce((n, l) => n + l.amount, 0)
      : whole.deal
    : m.priceSnapshot;
  const toggle = (p: OldPlan) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(keyOf(p))) n.delete(keyOf(p));
      else n.add(keyOf(p));
      return n;
    });

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
        clientName: memberName,
      });
      onClose();
      onDone?.();
      toastWithUndo(
        "Marked as paid in the old software",
        () => undoOldSoftwareMove(r.moveId, money),
        whole
          ? `${formatPrice(takenOff)} taken off this app's money; ${formatPrice(whole.paid)} paid in the old software.`
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
        {bill ? (
          <p className="rounded-xl bg-muted p-3 text-sm">
            Entered here: bill {bill.invoiceNumber}
            {bill.items.length ? ` (${bill.items.map((i) => i.name).join(" + ")})` : ""}, total{" "}
            {formatPrice(bill.total)}, recorded as paid here{" "}
            <b className="tabular-nums">{formatPrice(plan?.paidHere ?? bill.amountPaid)}</b>
            {bill.balanceDue > 0 ? `, ${formatPrice(bill.balanceDue)} owed` : ""}.
          </p>
        ) : null}

        {/* The old software's record: everything, so the decision is made with it in view. */}
        <section className="rounded-xl border border-border" aria-label="Old software record">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-3">
            <p className="font-semibold">Old software record</p>
            <p className="text-meta">
              {looking
                ? "Looking up…"
                : record
                  ? `${record.name} · ID ${record.memberId} · ${record.plans.length} plan${record.plans.length === 1 ? "" : "s"} · paid ${formatPrice(record.plans.reduce((n, p) => n + paidOf(p), 0))}`
                  : "No record found for this phone"}
            </p>
          </div>
          {record?.plans.length ? (
            <ul className="divide-y divide-border">
              {record.plans.map((p) => (
                <li key={keyOf(p)}>
                  <label className="flex cursor-pointer items-start gap-3 p-3 text-sm">
                    <Checkbox
                      checked={ticked.has(keyOf(p))}
                      onCheckedChange={() => toggle(p)}
                      disabled={!money || mode !== "whole"}
                      className="mt-0.5"
                      aria-label={`This bill covered ${p.name} ${p.start}`}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.name}</span>
                      <span className="text-meta block">
                        {formatDateISO(p.start)} → {formatDateISO(p.end)} · price{" "}
                        {formatPrice(p.price)}
                        {p.discount ? ` · discount ${formatPrice(p.discount)}` : ""} · to pay{" "}
                        {formatPrice(p.amount)} · paid {formatPrice(paidOf(p))}
                        {p.bill ? ` · bill ${p.bill}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

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
                Everything recorded here for this bill comes off. The bill becomes the ticked old
                plans, with what was paid there.
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

        {mode === "whole" && !fromRecord ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Old software price ₹"
              htmlFor="old-deal"
              hint={record ? "Tick the old plans above, or type it." : undefined}
            >
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
            <Field label="Paid there ₹" htmlFor="old-paid">
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
        ) : null}
        {mode === "part" ? (
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
        ) : null}
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
                    Plan price {formatPrice(m.priceSnapshot)} → {formatPrice(newPrice)}
                  </li>
                  <li>
                    Bill becomes{" "}
                    {fromRecord
                      ? lines.map((l) => `${l.name} ${formatPrice(l.amount)}`).join(" + ")
                      : formatPrice(whole.deal)}
                    , "Paid in the old software" {formatPrice(whole.paid)}, still owed{" "}
                    {formatPrice(plan.after.balanceDue)}
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
