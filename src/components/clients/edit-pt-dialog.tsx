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
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeTrainers } from "@/services/pt.service";
import { editPtPlan, ptChanges } from "@/services/pt-edit.service";
import { formatPrice } from "@/lib/format";
import type { PtAssignment, ShareType, Trainer } from "@/types/models";

/** "Edit PT plan": the trainer (owner: the share moves with it), the dates and the share. */
export function EditPtDialog({ pt, onClose }: { pt: PtAssignment | null; onClose: () => void }) {
  const open = !!pt;
  const { can } = useAccess();
  const { user } = useAuth();
  const trainers = useLive<Trainer[]>(open ? subscribeTrainers : null, [], [open]);
  const [trainerId, setTrainerId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [shareType, setShareType] = useState<ShareType>("percentage");
  const [shareValue, setShareValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!pt) return;
    setTrainerId(pt.trainerId);
    setStart(pt.startDate);
    setEnd(pt.endDate);
    setShareType(pt.trainerShareType);
    setShareValue(String(pt.trainerShareValue));
    setReason("");
    setError("");
  }, [pt]);
  const choices = useMemo(() => {
    const list = trainers.data
      .filter((t) => t.status === "active" || t.id === pt?.trainerId)
      .map((t) => ({ id: t.id, name: t.name }));
    if (pt && !list.some((t) => t.id === pt.trainerId))
      list.unshift({ id: pt.trainerId, name: pt.trainerNameSnapshot });
    return list;
  }, [trainers.data, pt]);
  if (!pt) return null;
  const money = can("finance");
  const trainer = choices.find((t) => t.id === trainerId) ?? {
    id: pt.trainerId,
    name: pt.trainerNameSnapshot,
  };
  const shareNumber = shareValue.trim() === "" ? Number.NaN : Number(shareValue);
  const form = {
    trainer,
    startDate: start,
    endDate: end,
    share: money ? { type: shareType, value: shareNumber } : undefined,
  };
  const shareBad =
    money &&
    (!(shareNumber >= 0) ||
      (shareType === "percentage" && shareNumber > 100) ||
      (shareType !== "percentage" && shareNumber > pt.ptPrice));
  const changes = ptChanges(pt, form);

  const save = async () => {
    setError("");
    try {
      await editPtPlan({
        pt,
        form,
        reason,
        canFinance: money,
        by: user?.displayName || user?.email || "Staff",
      });
      onClose();
      toast.success("PT plan updated", { description: changes.join(" · ") });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit PT plan"
      description={`${pt.ptPackageNameSnapshot} for ${pt.clientNameSnapshot} · PT price ${formatPrice(pt.ptPrice)}. A lower price is a discount: Edit bill.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save()} disabled={!changes.length || shareBad}>
            <Pencil aria-hidden /> Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="Trainer"
          htmlFor="pt-trainer"
          hint={
            money
              ? "Their unpaid share for this plan moves to the new trainer."
              : "Changing the trainer moves their share: it needs Income & expenses (the owner)."
          }
        >
          <Select value={trainer.id} onValueChange={setTrainerId} disabled={!money}>
            <SelectTrigger id="pt-trainer" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="pt-start">
            <Input
              id="pt-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="End date" htmlFor="pt-end">
            <Input
              id="pt-end"
              type="date"
              min={start || undefined}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Trainer's share"
          htmlFor="pt-share"
          hint={
            !money
              ? "Changing the share needs Income & expenses (the owner)."
              : shareBad
                ? shareType === "percentage"
                  ? "Enter 0 to 100 %."
                  : `Enter ₹0 to ${formatPrice(pt.ptPrice)}.`
                : "Their unpaid payout for this plan and the bill's trainer total follow."
          }
        >
          <div className="flex gap-2">
            <Select
              value={shareType}
              onValueChange={(v) => setShareType(v as ShareType)}
              disabled={!money}
            >
              <SelectTrigger className="w-28" aria-label="Share type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">%</SelectItem>
                <SelectItem value="fixed">₹ fixed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id="pt-share"
              type="number"
              inputMode="decimal"
              min={0}
              disabled={!money}
              value={shareValue}
              onChange={(e) => setShareValue(e.target.value)}
              className="max-w-36 tabular-nums"
            />
          </div>
        </Field>
        <Field label="Why the change? (optional)" htmlFor="pt-reason">
          <Input
            id="pt-reason"
            maxLength={300}
            placeholder="e.g. Member moved to the evening trainer"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {changes.length ? (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="font-semibold">Will change</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <EditLines edits={pt.edits} />
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
