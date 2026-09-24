import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint, KeyRound, Loader2, Pencil, Plus, Power, UserCog } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
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
import { Switch } from "@/components/ui/switch";
import { DEFAULT_STAFF_FEATURES, FEATURE_META } from "@/constants/features";
import { useLive } from "@/hooks/use-live-query";
import { formatPrice, todayISO } from "@/lib/format";
import { subscribeDevices } from "@/services/biometric-devices.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  createStaffLogin,
  getStaffPrivate,
  requestStaffFingerprint,
  saveStaff,
  saveStaffPrivate,
  subscribeStaff,
  subscribeStaffAccess,
  subscribeStaffCommands,
  subscribeStaffPrivate,
  suggestStaffBiometricId,
  updateStaffLogin,
  type StaffInput,
} from "@/services/staff.service";
import {
  STAFF_FEATURES,
  type BiometricDevice,
  type IncentiveType,
  type Staff,
  type StaffAccess,
  type StaffFeature,
  type StaffPrivate,
} from "@/types/models";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({ meta: [{ title: "Staff — REBUILD FITNESS" }] }),
  component: StaffPage,
});

const ROLES = ["Front desk", "Counsellor", "Manager", "Trainer", "Cleaner", "Other"];

function StaffPage() {
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const access = useLive<StaffAccess[]>(subscribeStaffAccess, [], []);
  const pay = useLive<StaffPrivate[]>(subscribeStaffPrivate, [], []);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [login, setLogin] = useState<Staff | null>(null);
  const [thumb, setThumb] = useState<Staff | null>(null);
  const accessOf = (s: Staff) => access.data.find((a) => a.uid === s.loginUid);
  const payOf = (s: Staff) => pay.data.find((p) => p.staffId === s.id);

  const toggleActive = async (s: Staff) => {
    try {
      await saveStaff({ ...pick(s), active: !s.active }, s.id);
      // Someone who left can't sign in any more; the door lock removes their thumb.
      if (s.active && s.loginUid) await updateStaffLogin({ staffId: s.id, active: false });
      toast.success(s.active ? `${s.name} marked as left` : `${s.name} is active again`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Everyone who works here: logins and what they can use, counsellors, pay and thumb."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Staff" }]}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add staff
          </Button>
        }
      />
      {staff.loading ? (
        <LoadingRows rows={4} />
      ) : staff.error ? (
        <ErrorState error={staff.error} title="Couldn't load staff" />
      ) : !staff.data.length ? (
        <EmptyState
          icon={UserCog}
          title="No staff yet"
          description="Add your front desk, counsellors and managers. Then give each one a login."
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add staff
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {staff.data.map((s) => {
            const a = accessOf(s);
            const p = payOf(s);
            return (
              <article key={s.id} className="surface-card flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-card-title truncate">{s.name}</h3>
                    <p className="text-meta">
                      {s.role || "Staff"} · {s.phone || "no phone"}
                    </p>
                  </div>
                  <StatusPill tone={s.active ? "success" : "warning"}>
                    {s.active ? "Active" : "Left"}
                  </StatusPill>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.isCounsellor ? <StatusPill tone="info">Counsellor</StatusPill> : null}
                  {a ? (
                    <StatusPill tone={a.active ? "success" : "danger"}>
                      {a.active
                        ? `Login · ${a.admin ? "all features" : `${a.permissions.length} features`}`
                        : "Login off"}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="warning">No login</StatusPill>
                  )}
                  <StatusPill tone={s.firstThumbRegistered ? "success" : "warning"}>
                    {s.firstThumbRegistered ? `Thumb · ID ${s.biometricUserId}` : "Thumb pending"}
                  </StatusPill>
                </div>
                {p ? (
                  <p className="text-meta">
                    Salary {formatPrice(p.monthlySalary)}/month
                    {p.incentiveType === "percentage"
                      ? ` · incentive ${p.incentiveValue}% of collections`
                      : p.incentiveType === "fixed"
                        ? ` · incentive ${formatPrice(p.incentiveValue)} per joining`
                        : ""}
                  </p>
                ) : null}
                {s.loginEmail ? <p className="text-meta truncate">{s.loginEmail}</p> : null}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLogin(s)}
                    disabled={!s.active}
                  >
                    <KeyRound aria-hidden /> {a ? "Login & features" : "Create login"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setThumb(s)}
                    disabled={!s.active}
                  >
                    <Fingerprint aria-hidden /> Thumb
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleActive(s)}>
                    <Power aria-hidden /> {s.active ? "Mark as left" : "Make active"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <StaffDialog item={editing} onClose={() => setEditing(null)} />
      <LoginDialog
        staff={login}
        access={login ? accessOf(login) : undefined}
        onClose={() => setLogin(null)}
      />
      <ThumbDialog
        staff={thumb ? (staff.data.find((s) => s.id === thumb.id) ?? thumb) : null}
        onClose={() => setThumb(null)}
      />
    </div>
  );
}

const pick = (s: Staff): StaffInput => ({
  name: s.name,
  phone: s.phone,
  role: s.role,
  joiningDate: s.joiningDate,
  active: s.active,
  isCounsellor: s.isCounsellor,
});

function StaffDialog({ item, onClose }: { item: Staff | "new" | null; onClose: () => void }) {
  const blank: StaffInput = {
    name: "",
    phone: "",
    role: "Front desk",
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
    setF(item === "new" ? blank : pick(item));
    setP({ monthlySalary: 0, incentiveType: "none", incentiveValue: 0 });
    if (item !== "new") void getStaffPrivate(item.id).then((x) => setP(x));
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (f.name.trim().length < 2) return setErr("Enter the staff member's name.");
    if (p.incentiveType === "percentage" && (p.incentiveValue < 0 || p.incentiveValue > 100))
      return setErr("Incentive percentage must be 0–100.");
    setSaving(true);
    try {
      const id = await saveStaff(f, item && item !== "new" ? item.id : undefined);
      await saveStaffPrivate({ staffId: id, ...p });
      toast.success("Staff saved");
      onClose();
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
      title={item === "new" ? "Add staff" : "Edit staff"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
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
        <Field label="Phone" htmlFor="st-phone">
          <Input
            id="st-phone"
            type="tel"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </Field>
        <Field label="Role" htmlFor="st-role">
          <Select
            value={ROLES.includes(f.role) ? f.role : "Other"}
            onValueChange={(v) =>
              setF({ ...f, role: v, isCounsellor: f.isCounsellor || v === "Counsellor" })
            }
          >
            <SelectTrigger id="st-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
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
      </div>
    </FormDialog>
  );
}

function LoginDialog({
  staff,
  access,
  onClose,
}: {
  staff: Staff | null;
  access: StaffAccess | undefined;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [features, setFeatures] = useState<StaffFeature[]>(DEFAULT_STAFF_FEATURES);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!staff) return;
    setEmail(access?.email ?? "");
    setPassword("");
    setAdmin(access?.admin ?? false);
    setFeatures(access ? access.permissions : DEFAULT_STAFF_FEATURES);
    setActive(access?.active ?? true);
  }, [staff, access]);
  const toggle = (f: StaffFeature, on: boolean) =>
    setFeatures((x) => (on ? [...new Set([...x, f])] : x.filter((y) => y !== f)));

  const save = async () => {
    if (!staff) return;
    setSaving(true);
    try {
      if (access) {
        await updateStaffLogin({
          staffId: staff.id,
          admin,
          permissions: features,
          active,
          ...(password ? { password } : {}),
        });
        toast.success("Login updated", { description: "Changes apply on their next page load." });
      } else {
        await createStaffLogin({
          staffId: staff.id,
          email,
          password,
          admin,
          permissions: features,
        });
        toast.success("Login created", { description: `${staff.name} can sign in with ${email}.` });
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={!!staff}
      onOpenChange={(o) => !o && onClose()}
      title={access ? `Login · ${staff?.name ?? ""}` : `Create login · ${staff?.name ?? ""}`}
      description="Tick what this person can use. The owner always has everything."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || (!access && (!email || password.length < 6))}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}{" "}
            {access ? "Save" : "Create login"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Login email" htmlFor="lg-email">
          <Input
            id="lg-email"
            type="email"
            value={email}
            disabled={!!access}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@gmail.com"
          />
        </Field>
        <Field
          label={access ? "New password (leave empty to keep)" : "Password"}
          htmlFor="lg-pass"
          hint="At least 6 characters. Tell it to the staff member."
        >
          <Input
            id="lg-pass"
            type="text"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {access ? (
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm font-semibold">Login is on</span>
              <span className="text-meta">Switch off to stop this person signing in.</span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Login is on" />
          </label>
        ) : null}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span>
            <span className="block text-sm font-semibold">All features (manager)</span>
            <span className="text-meta">Everything except creating logins.</span>
          </span>
          <Switch checked={admin} onCheckedChange={setAdmin} aria-label="All features" />
        </label>
        {!admin ? (
          <fieldset className="grid gap-2">
            <legend className="text-label mb-1">Features this login can use</legend>
            {STAFF_FEATURES.map((f) => (
              <label
                key={f}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent"
              >
                <Checkbox
                  checked={features.includes(f)}
                  onCheckedChange={(v) => toggle(f, v === true)}
                  aria-label={FEATURE_META[f].label}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-semibold">{FEATURE_META[f].label}</span>
                  <span className="text-meta">{FEATURE_META[f].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
    </FormDialog>
  );
}

function ThumbDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const usable = useMemo(
    () => devices.data.filter((d) => d.integrationType === "adms" && d.status !== "disabled"),
    [devices.data],
  );
  const [deviceId, setDeviceId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const cmds = useLive<{ type: string; status: string; error: string; createdAt: Date }[]>(
    staff ? (ok, fail) => subscribeStaffCommands(staff.id, ok, fail) : null,
    [],
    [staff?.id],
  );
  useEffect(() => {
    if (!staff) return;
    setDeviceId(staff.biometricDeviceId || "");
    if (staff.biometricUserId) setPin(staff.biometricUserId);
    else void suggestStaffBiometricId().then(setPin);
  }, [staff?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!deviceId && usable[0]) setDeviceId(usable[0].id);
  }, [usable, deviceId]);

  const enroll = cmds.data.find((c) => c.type === "enroll_fp");
  const state = staff?.firstThumbRegistered
    ? "Thumb registered. Punches now count as staff attendance."
    : enroll?.status === "pending"
      ? "Waiting for the device…"
      : enroll?.status === "sent"
        ? "Place the right thumb on the scanner 3 times, lifting it between presses."
        : enroll?.status === "failed"
          ? enroll.error || "The device could not capture the thumb. Try again."
          : "";

  const start = async () => {
    const device = usable.find((d) => d.id === deviceId);
    if (!staff || !device) return;
    setBusy(true);
    try {
      await requestStaffFingerprint(staff, device, pin);
      toast.success("Sent to the device");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={!!staff}
      onOpenChange={(o) => !o && onClose()}
      title={`Thumb · ${staff?.name ?? ""}`}
      description="Staff use the same fingerprint device. Their punches are staff attendance and always open the door."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={busy || !usable.length || !pin} onClick={() => void start()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Fingerprint aria-hidden />}{" "}
            Register thumb on device
          </Button>
        </>
      }
    >
      {!usable.length ? (
        <p className="text-sm text-muted-foreground">
          No fingerprint device is connected yet. Add one in Fingerprint Devices.
        </p>
      ) : (
        <div className="grid gap-4">
          <Field label="Device" htmlFor="th-dev">
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger id="th-dev" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {usable.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="ID on the device"
            htmlFor="th-pin"
            hint="Staff IDs start at 9001 so they never clash with members."
          >
            <Input
              id="th-pin"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          {state ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-muted/40 p-3 text-sm font-medium"
            >
              {state}
            </p>
          ) : null}
        </div>
      )}
    </FormDialog>
  );
}
