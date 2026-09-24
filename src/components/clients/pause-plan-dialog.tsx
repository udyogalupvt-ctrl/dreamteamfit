import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { addDaysISO, formatDateISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { pauseMembership } from "@/services/memberships.service";
import { PAUSE_REASONS, type Membership } from "@/types/models";

const QUICK = [7, 15, 30];

/** Pause a plan (member away): the end date moves forward by the days chosen. */
export function PausePlanDialog({
  membership,
  isCurrent,
  onClose,
}: {
  membership: Membership | null;
  isCurrent: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [days, setDays] = useState("15");
  const [reason, setReason] = useState<string>("Travel");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (membership) {
      setDays("15");
      setReason("Travel");
      setNote("");
    }
  }, [membership]);

  const n = Math.floor(Number(days));
  const valid = n >= 1 && n <= 365;
  const save = async () => {
    if (!membership || !valid) return;
    setSaving(true);
    try {
      const end = await pauseMembership(
        membership,
        { days: n, reason, note },
        user?.displayName || user?.email || "Staff",
        isCurrent,
      );
      toast.success(`Plan paused ${n} days`, { description: `Now ends ${formatDateISO(end)}` });
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={!!membership}
      onOpenChange={(o) => !o && onClose()}
      title="Pause plan"
      description="For a member who is away. The plan's end date moves forward by these days."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Pause{" "}
            {valid ? `${n} days` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="How many days?" htmlFor="pause-days" required>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick days">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  aria-pressed={n === q}
                  onClick={() => setDays(String(q))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-semibold",
                    n === q
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {q} days
                </button>
              ))}
            </div>
            <Input
              id="pause-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="max-w-40"
            />
          </div>
        </Field>
        <Field label="Why?" htmlFor="pause-reason">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" id="pause-reason">
            {PAUSE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-semibold",
                  reason === r
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Note (optional)" htmlFor="pause-note">
          <Input
            id="pause-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Going home for Sankranti"
          />
        </Field>
        {membership && valid ? (
          <p className="rounded-xl bg-muted p-3 text-sm">
            Ends <b>{formatDateISO(membership.endDate)}</b> → now ends{" "}
            <b>{formatDateISO(addDaysISO(membership.endDate, n))}</b>
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
