import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Eye,
  Fingerprint,
  KeyRound,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Power,
  Smartphone,
  Trash2,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StaffDialog } from "@/components/staff/staff-dialog";
import { StaffThumbDialog } from "@/components/staff/staff-thumb-dialog";
import { TrainerAppDialog } from "@/components/staff/trainer-app-dialog";
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
import { DEFAULT_STAFF_FEATURES, DELETE_FEATURES, FEATURE_META } from "@/constants/features";
import { useAccess } from "@/hooks/use-access";
import { useBin } from "@/hooks/use-bin";
import { useStaffTrainers } from "@/hooks/use-staff-trainers";
import { useLive } from "@/hooks/use-live-query";
import { toastWithUndo } from "@/lib/undo-toast";
import { binStaff } from "@/services/recycle-bin.service";
import { isLoginRole, isTrainerRole, trainerOfStaff } from "@/services/staff-trainers.service";
import { formatPrice } from "@/lib/format";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { staffSavedPassword, whatsAppShareUrl } from "@/services/portal.service";
import {
  createStaffLogin,
  saveStaff,
  staffInputOf,
  subscribeStaffAccess,
  subscribeStaffPrivate,
  updateStaffLogin,
} from "@/services/staff.service";
import {
  STAFF_FEATURES,
  type Staff,
  type StaffAccess,
  type StaffFeature,
  type StaffPrivate,
} from "@/types/models";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({ meta: [{ title: "Staff — REBUILD FITNESS" }] }),
  component: StaffPage,
});

function StaffPage() {
  const { staff, trainers } = useStaffTrainers();
  const access = useLive<StaffAccess[]>(subscribeStaffAccess, [], []);
  const { owner, can } = useAccess();
  const finance = can("finance");
  const pay = useLive<StaffPrivate[]>(finance ? subscribeStaffPrivate : null, [], [finance]);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [login, setLogin] = useState<Staff | null>(null);
  const [thumb, setThumb] = useState<Staff | null>(null);
  const [trainerApp, setTrainerApp] = useState<string | null>(null);
  // A new front desk / manager goes straight to "Create login" once saved.
  const [loginNext, setLoginNext] = useState<string | null>(null);
  useEffect(() => {
    const s = loginNext ? staff.data.find((x) => x.id === loginNext) : undefined;
    if (!s) return;
    setLoginNext(null);
    setLogin(s);
  }, [loginNext, staff.data]);
  const accessOf = (s: Staff) => access.data.find((a) => a.uid === s.loginUid);
  // Delete (owners only): into the Recycle Bin; login off and thumb off the machine.
  const bin = useBin();
  const [deleting, setDeleting] = useState<Staff | null>(null);
  const payOf = (s: Staff) => pay.data.find((p) => p.staffId === s.id);
  const appTrainer = trainerApp ? (trainers.data.find((t) => t.id === trainerApp) ?? null) : null;

  const toggleActive = async (s: Staff) => {
    try {
      await saveStaff({ ...staffInputOf(s), active: !s.active }, s.id);
      // Someone who left can't sign in any more; the door lock removes their thumb.
      const loginOff = s.active && !!s.loginUid && accessOf(s)?.active !== false;
      if (loginOff) await updateStaffLogin({ staffId: s.id, active: false });
      // Undo (a tap by mistake): back as they were, login on again too (owner).
      toastWithUndo(
        s.active ? `${s.name} marked as left` : `${s.name} is active again`,
        async () => {
          await saveStaff({ ...staffInputOf(s), active: s.active }, s.id);
          if (loginOff && owner) await updateStaffLogin({ staffId: s.id, active: true });
        },
        s.active && isTrainerRole(s.role) ? "They no longer take PT members." : undefined,
      );
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Everyone who works here, made once: front desk and managers get a gym login, trainers get the trainer app and appear in Packages & Trainers."
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
          description="Add your front desk, managers and trainers. Front desk and managers then get a login."
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
            const trainer = isTrainerRole(s.role) ? trainerOfStaff(s, trainers.data) : null;
            // Gym logins are for the front desk and managers (and anyone who already has one).
            const loginButton = owner && (isLoginRole(s.role) || !!a);
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
                        ? `Login · ${a.admin ? "all pages" : `${a.permissions.length} features`}`
                        : "Login off"}
                    </StatusPill>
                  ) : isLoginRole(s.role) ? (
                    <StatusPill tone="warning">No login</StatusPill>
                  ) : null}
                  {isTrainerRole(s.role) ? (
                    <StatusPill
                      tone={
                        !trainer?.portalCode
                          ? "warning"
                          : trainer.portalActive
                            ? "success"
                            : "danger"
                      }
                    >
                      {!trainer?.portalCode
                        ? "No trainer app"
                        : trainer.portalActive
                          ? "Trainer app on"
                          : "Trainer app off"}
                    </StatusPill>
                  ) : null}
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
                {trainer ? (
                  <p className="text-meta">
                    PT share:{" "}
                    {trainer.defaultTrainerShare > 0
                      ? trainer.defaultShareType === "percentage"
                        ? `${trainer.defaultTrainerShare}%`
                        : formatPrice(trainer.defaultTrainerShare)
                      : "not set"}{" "}
                    ·{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        void navigate({ to: "/packages", search: { tab: "trainers" } })
                      }
                    >
                      Packages &amp; Trainers
                    </button>
                  </p>
                ) : null}
                {s.loginEmail ? <p className="text-meta truncate">{s.loginEmail}</p> : null}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                  {loginButton ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLogin(s)}
                      disabled={!s.active}
                    >
                      <KeyRound aria-hidden /> {a ? "Login & features" : "Create login"}
                    </Button>
                  ) : null}
                  {trainer ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTrainerApp(trainer.id)}
                      disabled={!s.active}
                    >
                      <Smartphone aria-hidden /> Trainer app
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setThumb(s)}
                    disabled={!s.active}
                  >
                    <Fingerprint aria-hidden /> Thumb
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(s)}>
                    <Power aria-hidden /> {s.active ? "Mark as left" : "Make active"}
                  </Button>
                  {bin.canDelete("staff") ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => setDeleting(s)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <StaffDialog
        item={editing}
        onClose={() => setEditing(null)}
        onCreated={(id, role) => {
          if (owner && isLoginRole(role)) setLoginNext(id);
        }}
      />
      <LoginDialog
        staff={login}
        access={login ? accessOf(login) : undefined}
        onClose={() => setLogin(null)}
      />
      <StaffThumbDialog
        staff={thumb ? (staff.data.find((s) => s.id === thumb.id) ?? thumb) : null}
        onClose={() => setThumb(null)}
      />
      <TrainerAppDialog trainer={appTrainer} onClose={() => setTrainerApp(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Their login (and trainer app) stops and their thumb leaves the fingerprint machine. Attendance, salary and PT history stay. They wait in the Recycle Bin, where they can be restored (register their thumb again then)."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const s = deleting;
          setDeleting(null);
          if (s)
            void bin.remove(s.name, (by) =>
              binStaff(s, accessOf(s), by, trainerOfStaff(s, trainers.data)),
            );
        }}
      />
    </div>
  );
}

/**
 * The login's password from the encrypted password safe (owner only), to read out or send
 * again on WhatsApp. Logins made before the safe existed show "not saved" until a new one is set.
 */
function SavedPassword({ staff, email }: { staff: Staff; email: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPassword(null), [staff.id]);
  const load = async () => {
    setBusy(true);
    try {
      const r = await staffSavedPassword(staff.id);
      setPassword(r.password);
      return r.password;
    } catch (e) {
      toast.error((e as Error).message);
      return "";
    } finally {
      setBusy(false);
    }
  };
  const send = () => {
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    void (async () => {
      const pw = password || (await load());
      if (!pw) return win?.close();
      const text = `Hi ${staff.name.split(" ")[0]}, your gym app login: ${window.location.origin}/login\nEmail: ${email}\nPassword: ${pw}`;
      const target = whatsAppShareUrl(staff.phone, text);
      if (win) win.location.href = target;
      else window.open(target, "_blank", "noopener,noreferrer");
    })();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
      <span className="text-meta">Saved password:</span>
      {password === null ? (
        <>
          <span className="font-mono font-bold">••••••</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => load()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />} Show
          </Button>
        </>
      ) : password ? (
        <span className="font-mono font-bold tracking-wider">{password}</span>
      ) : (
        <span className="text-meta">
          Not saved (made before the password safe). Type a new password above and save.
        </span>
      )}
      {password !== "" ? (
        <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={send}>
          <MessageCircle aria-hidden /> Send on WhatsApp
        </Button>
      ) : null}
    </div>
  );
}

/** Every page a login can be given (delete rights are separate). */
const PAGE_FEATURES = STAFF_FEATURES.filter((f) => !DELETE_FEATURES.includes(f));

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
      description="Gym logins are for the front desk and managers. Tick the pages this person can use, or give all pages. The owner always has everything."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || (!access && (!email || password.length < 6))}
            onClick={() => save()}
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
          hint="At least 6 characters. Saved safely: you can see it and send it again later."
        >
          <Input
            id="lg-pass"
            type="text"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {access && staff ? <SavedPassword staff={staff} email={access.email} /> : null}
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
            <span className="block text-sm font-semibold">All pages (full access)</span>
            <span className="text-meta">
              Every page, Staff and Recycle Bin included. Making logins stays with you, and deleting
              only where you tick it below.
            </span>
          </span>
          <Switch checked={admin} onCheckedChange={setAdmin} aria-label="All pages" />
        </label>
        {!admin ? (
          <fieldset className="grid gap-2">
            <legend className="text-label mb-1">Pages this login can use</legend>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent">
              <Checkbox
                checked={PAGE_FEATURES.every((f) => features.includes(f))}
                onCheckedChange={(v) => PAGE_FEATURES.forEach((f) => toggle(f, v === true))}
                aria-label="Tick every page"
              />
              <span className="text-sm font-semibold">Tick every page</span>
            </label>
            {PAGE_FEATURES.map((f) => (
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
        {/* Delete rights: only the owner by default, not part of "All features". */}
        <fieldset className="grid gap-2">
          <legend className="text-label mb-1">Can delete (it goes to the Recycle Bin)</legend>
          <p className="text-meta -mt-1">
            Off for everyone but you unless you tick it. You see who deleted what in the Recycle
            Bin, and can put it back.
          </p>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent">
            <Checkbox
              checked={DELETE_FEATURES.every((f) => features.includes(f))}
              onCheckedChange={(v) => DELETE_FEATURES.forEach((f) => toggle(f, v === true))}
              aria-label="Delete in every section"
            />
            <span className="text-sm font-semibold">Every section</span>
          </label>
          {DELETE_FEATURES.map((f) => (
            <label
              key={f}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent"
            >
              <Checkbox
                checked={features.includes(f)}
                onCheckedChange={(v) => toggle(f, v === true)}
                aria-label={`Delete ${FEATURE_META[f].label}`}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold">{FEATURE_META[f].label}</span>
                <span className="text-meta">{FEATURE_META[f].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </FormDialog>
  );
}
