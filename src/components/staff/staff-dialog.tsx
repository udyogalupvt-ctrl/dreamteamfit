import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { useAccess } from "@/hooks/use-access";
import { todayISO } from "@/lib/format";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { isTrainerRole, STAFF_ROLES } from "@/services/staff-trainers.service";
import {
  getStaffPrivate,
  saveStaff,
  saveStaffPrivate,
  staffInputOf,
  type StaffInput,
} from "@/services/staff.service";
import type { IncentiveType, Staff, StaffPrivate } from "@/types/models";

/**
 * Add or edit someone who works here. A Trainer here is also the PT trainer in Packages &
 * Trainers (made once, here). Pay is shown only to logins that may see salaries.
 */
export function StaffDialog({
  item,
  onClose,
  onCreated,
  presetRole,
}: {
  item: Staff | "new" | null;
  onClose: () => void;
  /** After a new staff member is saved (e.g. to make their login next). */
  onCreated?: (staffId: string, role: string) => void;
  /** A new staff member starts with this role (e.g. "Trainer" from Packages & Trainers). */
  presetRole?: string;
}) {
  const { can } = useAccess();
  const pay = can("finance");
  const blank: StaffInput = {
    name: "",
    phone: "",
    role: presetRole ?? "Front desk",
    joiningDate: todayISO(),
    active: true,
    isCounsellor: false,
  };
  const [f, setF] = useState<StaffInput>(blank);
  const [p, setP] = useState<Omit<StaffPrivate, "staffId">>({
    monthlySalary: 0,
    incentiveType: "none",
    incentiveValue: 0,
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!item) return;
    setErr("");
    setF(item === "new" ? blank : staffInputOf(item));
    setP({ monthlySalary: 0, incentiveType: "none", incentiveValue: 0 });
    if (item !== "new" && pay)
      void getStaffPrivate(item.id)
        .then((x) => setP(x))
        .catch(() => undefined);
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (f.name.trim().length < 2) return setErr("Enter the staff member's name.");
    if (isTrainerRole(f.role) && f.phone.replace(/\D/g, "").length < 10)
      return setErr("Enter the trainer's mobile number (their trainer app login is sent to it).");
    if (p.incentiveType === "percentage" && (p.incentiveValue < 0 || p.incentiveValue > 100))
      return setErr("Incentive percentage must be 0–100.");
    setSaving(true);
    try {
      const id = await saveStaff(f, item && item !== "new" ? item.id : undefined);
      if (pay) await saveStaffPrivate({ staffId: id, ...p });
      toast.success(
        "Staff saved",
        isTrainerRole(f.role)
          ? {
              description: "They are also a PT trainer: set their PT share in Packages & Trainers.",
            }
          : {},
      );
      onClose();
      if (item === "new") onCreated?.(id, f.role);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={
        item === "new" ? (presetRole === "Trainer" ? "New trainer" : "Add staff") : "Edit staff"
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {err ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {err}
          </p>
        ) : null}
        <Field label="Name" htmlFor="st-name" required>
          <Input
            id="st-name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Phone" htmlFor="st-phone" required={isTrainerRole(f.role)}>
          <Input
            id="st-phone"
            type="tel"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </Field>
        <Field label="Role" htmlFor="st-role">
          <Select
            value={STAFF_ROLES.includes(f.role) ? f.role : "Other"}
            onValueChange={(v) =>
              setF({ ...f, role: v, isCounsellor: f.isCounsellor || v === "Counsellor" })
            }
          >
            <SelectTrigger id="st-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Joining date" htmlFor="st-join">
          <Input
            id="st-join"
            type="date"
            value={f.joiningDate}
            onChange={(e) => setF({ ...f, joiningDate: e.target.value })}
          />
        </Field>
        {isTrainerRole(f.role) ? (
          <p className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm sm:col-span-2">
            A trainer is made once, here. They also appear in <b>Packages &amp; Trainers</b>, where
            you set their PT share and their trainer app login.
          </p>
        ) : null}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 sm:col-span-2">
          <span>
            <span className="block text-sm font-semibold">Counsellor</span>
            <span className="text-meta">
              Shown in the Counsellor list when a member joins or renews.
            </span>
          </span>
          <Switch
            checked={f.isCounsellor}
            onCheckedChange={(v) => setF({ ...f, isCounsellor: v })}
            aria-label="Counsellor"
          />
        </label>
        {pay ? (
          <>
            <Field label="Monthly salary ₹" htmlFor="st-salary">
              <Input
                id="st-salary"
                type="number"
                min={0}
                inputMode="numeric"
                value={p.monthlySalary}
                onChange={(e) => setP({ ...p, monthlySalary: Number(e.target.value) })}
              />
            </Field>
            <Field label="Incentive" htmlFor="st-inc-type">
              <Select
                value={p.incentiveType}
                onValueChange={(v) => setP({ ...p, incentiveType: v as IncentiveType })}
              >
                <SelectTrigger id="st-inc-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No incentive</SelectItem>
                  <SelectItem value="percentage">% of money collected</SelectItem>
                  <SelectItem value="fixed">₹ per joining / renewal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {p.incentiveType !== "none" ? (
              <Field
                label={p.incentiveType === "percentage" ? "Incentive %" : "Incentive ₹ per joining"}
                htmlFor="st-inc"
                hint="Counted on members where this person is the counsellor."
              >
                <Input
                  id="st-inc"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={p.incentiveValue}
                  onChange={(e) => setP({ ...p, incentiveValue: Number(e.target.value) })}
                />
              </Field>
            ) : null}
          </>
        ) : null}
      </div>
    </FormDialog>
  );
}
