import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
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
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { addDaysISO, formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { isOldPtPlanName, matchStaffName, type OldPlan } from "@/lib/old-data";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { enrollMember } from "@/services/enrollment.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribePackages } from "@/services/packages.service";
import { subscribePtPackages, subscribeTrainers } from "@/services/pt.service";
import { subscribeStaff } from "@/services/staff.service";
import type { Client } from "@/types/models";

const oldDays = (p: OldPlan) =>
  Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86_400_000) + 1;

/**
 * The one package here most like the old plan: the same length and, for gym plans, cardio +
 * strength or strength only (from its name, else the member's other old plans, e.g. "1st
 * Anniversary offer"); for PT, alternate days or daily. null when it isn't clear.
 */
function likely<T extends { id: string; name: string; durationDays: number }>(
  plan: OldPlan,
  others: OldPlan[],
  packages: T[],
  pt: boolean,
) {
  const months = Math.round(oldDays(plan) / 30.44);
  const want = months >= 12 ? 365 : months * 30;
  const same = packages.filter((p) => Math.abs(p.durationDays - want) <= 3);
  let fit = same;
  if (pt) {
    const alt = /\balt/i.test(plan.name);
    fit = same.filter((p) => /\balt/i.test(p.name) === alt);
  } else {
    const kindOf = (s: string) =>
      /cardio|c\s*&\s*s/i.test(s) ? "cardio" : /strength/i.test(s) ? "strength" : "";
    const kind = kindOf(plan.name) || others.map((p) => kindOf(p.name)).find(Boolean) || "";
    if (kind) fit = same.filter((p) => /cardio/i.test(p.name) === (kind === "cardio"));
  }
  return (fit.length === 1 ? fit[0] : same.length === 1 ? same[0] : null) ?? null;
}

/**
 * A member whose plan still runs in the old software, but here has no plan for today (only an
 * older or a later one, e.g. the renewal was entered first): the door stays shut. This adds the
 * old plan here as paid in the old software, with the old software's own dates and amounts (no
 * money counted today), so the thumb works again. Same save as joining with "Paid in the old
 * software"; a PT plan there is added as a PT plan with its trainer (no trainer payout here).
 */
export function AddOldPlanDialog({
  client,
  plan,
  others,
  open,
  onClose,
}: {
  client: Client;
  plan: OldPlan;
  /** The member's other plans in the old software (to tell cardio from strength). */
  others: OldPlan[];
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const pt = isOldPtPlanName(plan.name);
  const packages = useLive(open && !pt ? subscribePackages : null, [], [open, pt]);
  const ptPackages = useLive(open && pt ? subscribePtPackages : null, [], [open, pt]);
  const trainers = useLive(open && pt ? subscribeTrainers : null, [], [open, pt]);
  const staff = useLive(open ? subscribeStaff : null, [], [open]);
  const settings = useLive(open ? subscribeBusinessSettings : null, DEFAULT_BILLING_SETTINGS, [
    open,
  ]);
  const gymList = useMemo(() => packages.data.filter((p) => p.isActive), [packages.data]);
  const ptList = useMemo(() => ptPackages.data.filter((p) => p.isActive), [ptPackages.data]);
  const trainerList = useMemo(
    () => trainers.data.filter((t) => t.status === "active"),
    [trainers.data],
  );
  const [pkgId, setPkgId] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [payBy, setPayBy] = useState("");
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setPkgId("");
    setTrainerId("");
    setPayBy(addDaysISO(todayISO(), 7));
    setRemind(false);
    setError("");
  }, [open]);
  const list: { id: string; name: string; durationDays: number; price: number }[] = pt
    ? ptList
    : gymList;
  const guess = likely(plan, others, list, pt);
  const pkgPick = pkgId || guess?.id || "";
  const gymPkg = pt ? null : (gymList.find((p) => p.id === pkgPick) ?? null);
  const ptPkg = pt ? (ptList.find((p) => p.id === pkgPick) ?? null) : null;
  // In the old software the trainer is written as the plan's counsellor.
  const trainerGuess = pt && plan.counsellor ? matchStaffName(trainerList, plan.counsellor) : null;
  const trainer = trainerList.find((t) => t.id === (trainerId || trainerGuess?.id)) ?? null;
  const paid = Math.max(0, plan.amount - plan.balance);
  const counsellor =
    !pt && plan.counsellor
      ? matchStaffName(
          staff.data.filter((s) => s.active),
          plan.counsellor,
        )
      : null;
  const ready = pt ? !!(ptPkg && trainer) : !!gymPkg;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await enrollMember({
        client: {
          fullName: client.fullName,
          phone: client.phone,
          email: client.email,
          profilePhotoUrl: client.profilePhotoUrl,
          dateOfBirth: client.dateOfBirth,
          gender: client.gender,
          address: client.address,
          emergencyContact: client.emergencyContact,
          source: client.source,
          notes: client.notes,
          status: client.status,
          joinedOn: client.joinedOn,
          oldMemberId: client.oldMemberId,
        },
        whatsappOptIn: client.whatsappOptIn,
        existingClient: client,
        inquiryId: null,
        gymPackage: gymPkg,
        pt:
          ptPkg && trainer
            ? {
                pkg: ptPkg,
                trainer,
                shareType: trainer.defaultShareType,
                shareValue: trainer.defaultTrainerShare,
              }
            : null,
        startDate: plan.start,
        discount: 0,
        amountPaid: 0,
        method: "Cash",
        notes: "",
        settings: settings.data,
        staff: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Staff" },
        counsellor: counsellor ? { id: counsellor.id, name: counsellor.name } : null,
        nextPaymentDate: plan.balance > 0 ? payBy : null,
        memberId: client.clientCode,
        upgrade: null,
        oldSoftware: { balance: plan.balance, paid, billNo: plan.bill, end: plan.end, remind },
      });
      onClose();
      toast.success("Plan from the old software added", {
        description: `Until ${formatDateISO(plan.end)}. The thumb opens the door again within a minute.`,
      });
    } catch (e) {
      setError(e instanceof Error && !("code" in e) ? e.message : firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add the plan running in the old software"
      description={`${client.fullName}'s plan still runs in the old software but is not in this app, so the door stays shut. It is added as paid there: its own dates and amount, no money counted today.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!ready || busy || (plan.balance > 0 && !payBy)}
          >
            <History aria-hidden /> {busy ? "Adding…" : "Add plan · paid in the old software"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
          <p className="font-semibold">{plan.name}</p>
          <p className="text-meta tabular-nums">
            {formatDateISO(plan.start)} → {formatDateISO(plan.end)} · paid {formatPrice(paid)}
            {plan.balance > 0 ? ` · balance ${formatPrice(plan.balance)}` : ""}
            {plan.bill ? ` · bill ${plan.bill}` : ""}
          </p>
        </div>
        <Field
          label={pt ? "Similar PT package here" : "Similar package here"}
          htmlFor="old-plan-pkg"
          hint="Only for the plan's name here: the dates and amount stay as in the old software."
        >
          <Select value={pkgPick} onValueChange={setPkgId}>
            <SelectTrigger id="old-plan-pkg" className="w-full">
              <SelectValue placeholder="Pick the package" />
            </SelectTrigger>
            <SelectContent>
              {list.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.durationDays} days · {formatPrice(p.price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {pt ? (
          <Field label="Trainer" htmlFor="old-plan-trainer">
            <Select value={trainer?.id ?? ""} onValueChange={setTrainerId}>
              <SelectTrigger id="old-plan-trainer" className="w-full">
                <SelectValue placeholder="Pick the trainer" />
              </SelectTrigger>
              <SelectContent>
                {trainerList.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {plan.balance > 0 ? (
          <Field label="They will pay the balance on" htmlFor="old-plan-payby">
            <Input
              id="old-plan-payby"
              type="date"
              min={todayISO()}
              value={payBy}
              onChange={(e) => setPayBy(e.target.value)}
              className="w-auto"
            />
          </Field>
        ) : null}
        {plan.balance > 0 ? <RemindOldBalance checked={remind} onChange={setRemind} /> : null}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

/**
 * The old software's balance is often stale (paid there, never updated), so the daily WhatsApp
 * balance reminders go out only when staff tick this after checking with the member.
 */
export function RemindOldBalance({
  checked,
  onChange,
  id = "old-plan-remind",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        <span className="block font-semibold">Send WhatsApp reminders for this balance</span>
        <span className="text-meta">
          Tick only after checking with the member that it is still owed: the old software was not
          always updated when a balance was paid. Unticked, the bill still shows the balance to
          collect at the desk.
        </span>
      </span>
    </label>
  );
}
