import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  decideReward,
  REFERRAL_LIMITS,
  REWARD_KINDS,
  rewardLabel,
  type RewardOutcome,
} from "@/lib/referrals";
import { formatDateISO } from "@/lib/format";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  markRewardGiven,
  recordReward,
  reopenReferral,
  restoreReferral,
} from "@/services/referrals.service";
import type { Referral, ReferralStatus, RewardKind } from "@/types/models";
import type { StatTone } from "@/types";

export const REFERRAL_TONE: Record<ReferralStatus, StatTone> = {
  due: "warning",
  promised: "violet",
  given: "success",
  skipped: "info",
};

const OUTCOMES: { key: RewardOutcome; label: string; hint: string }[] = [
  { key: "given", label: "Given now", hint: "Handed over or added today." },
  { key: "promised", label: "Promise it", hint: "Give it at their next renewal." },
  { key: "skipped", label: "No reward", hint: "Say why, so nobody asks again." },
];

const undo = (prev: Referral) => ({
  label: "Undo",
  onClick: () =>
    void restoreReferral(prev).catch((e: unknown) => toast.error(firestoreErrorMessage(e))),
});

/** Mark given / reopen, with an Undo toast. `busy` covers whichever is running. */
export function useReferralActions() {
  const [busy, setBusy] = useState(false);
  const run = async (r: Referral, act: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await act();
      toast.success(done, { action: undo(r) });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    markGiven: (r: Referral) =>
      run(r, () => markRewardGiven(r), `Reward given · ${r.referrerName}`),
    reopen: (r: Referral) =>
      run(r, () => reopenReferral(r), `Back to Reward due · ${r.referrerName}`),
  };
}

/**
 * Record (or change) the reward for one friend who joined. Nothing is applied by itself: free days
 * go on the referrer's plan with Edit plan, money off at their next bill.
 */
export function RewardDialog({
  referral: r,
  onOpenChange,
}: {
  referral: Referral;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [outcome, setOutcome] = useState<RewardOutcome>(r.status === "due" ? "given" : r.status);
  const [kind, setKind] = useState<RewardKind>(r.reward?.kind ?? "free_days");
  const [days, setDays] = useState(r.reward?.days ? String(r.reward.days) : "");
  const [amount, setAmount] = useState(r.reward?.amount ? String(r.reward.amount) : "");
  const [note, setNote] = useState(r.reward?.note ?? "");
  const [reason, setReason] = useState(r.reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const referrer = r.referrerName || "the member";
  const friend = r.newClientName || "their friend";

  const save = async () => {
    const res = decideReward({ outcome, kind, days, amount, note, reason });
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await recordReward(r, res.decision);
      const d = res.decision;
      toast.success(
        d.status === "skipped"
          ? `No reward · ${referrer}`
          : `${d.status === "given" ? "Given" : "Promised"}: ${rewardLabel(d.reward)} · ${referrer}`,
        { action: undo(r) },
      );
      onOpenChange(false);
    } catch (e) {
      setError(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const noteLabel = kind === "gift" ? "What gift" : kind === "other" ? "The reward" : "Note";
  const needsNote = kind === "gift" || kind === "other";
  const applyHint =
    outcome === "skipped"
      ? ""
      : kind === "free_days"
        ? outcome === "given"
          ? "Also add the days to their plan: Edit plan on their profile."
          : "Add the days with Edit plan when they renew."
        : kind === "discount"
          ? "Take it off their next bill as a discount."
          : "";

  return (
    <FormDialog
      open
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={`Reward for ${referrer}`}
      description={`For bringing ${friend}${r.joinedOn ? ` (joined ${formatDateISO(r.joinedOn)})` : ""}.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <RadioGroup
          value={outcome}
          onValueChange={(v) => {
            setOutcome(v as RewardOutcome);
            setError("");
          }}
          aria-label="What happens"
          className="grid gap-2 sm:grid-cols-3"
        >
          {OUTCOMES.map((o) => (
            <Label
              key={o.key}
              htmlFor={`${id}-${o.key}`}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/60"
            >
              <RadioGroupItem id={`${id}-${o.key}`} value={o.key} className="mt-0.5" />
              <span>
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-meta">{o.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        {outcome === "skipped" ? (
          <Field label="Why no reward" htmlFor={`${id}-reason`} required>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={REFERRAL_LIMITS.reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Friend left in the first week"
              className="field-sizing-content min-h-16"
            />
          </Field>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reward" htmlFor={`${id}-kind`}>
                <Select value={kind} onValueChange={(v) => setKind(v as RewardKind)}>
                  <SelectTrigger id={`${id}-kind`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REWARD_KINDS.map((k) => (
                      <SelectItem key={k.key} value={k.key}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {kind === "free_days" ? (
                <Field label="Days" htmlFor={`${id}-days`} required>
                  <Input
                    id={`${id}-days`}
                    inputMode="numeric"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="e.g. 7"
                  />
                </Field>
              ) : kind === "discount" ? (
                <Field label="Amount off (₹)" htmlFor={`${id}-amount`} required>
                  <Input
                    id={`${id}-amount`}
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 500"
                  />
                </Field>
              ) : null}
            </div>
            <Field
              label={noteLabel}
              htmlFor={`${id}-note`}
              required={needsNote}
              hint={applyHint || undefined}
            >
              <Input
                id={`${id}-note`}
                value={note}
                maxLength={REFERRAL_LIMITS.note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  kind === "gift"
                    ? "e.g. Gym T-shirt"
                    : kind === "other"
                      ? "e.g. Free diet chart"
                      : "Optional"
                }
              />
            </Field>
            {kind === "free_days" && r.referrerId ? (
              <p className="text-meta">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: r.referrerId }}
                  className="font-medium text-primary hover:underline"
                >
                  Open {referrer}'s profile
                </Link>
              </p>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
