import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  DoorClosed,
  DoorOpen,
  Download,
  ImageIcon,
  Link2,
  Loader2,
  Search,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FormDialog } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLive } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";
import {
  countDeviceUsers,
  linkMachineUser,
  loadDeviceUsers,
  readUsersFromMachine,
  removeMachineUser,
  setDoorControl,
  setSendPhotos,
} from "@/services/biometric-devices.service";
import { subscribeClients } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeStaff } from "@/services/staff.service";
import type { BiometricDevice, Client, DeviceUser, Staff } from "@/types/models";

const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/**
 * Door control switch and the people already registered on the machine (e.g. by the old
 * software): read them, link each machine ID to a member or staff member, or take them off.
 */
export function DeviceUsersSection({ device }: { device: BiometricDevice }) {
  // A machine can hold ~1,000 people: a count is cheap, the full list is loaded only when asked
  // for (the free database allowance is 50,000 reads a day).
  const [count, setCount] = useState<number | null>(null);
  const [users, setUsers] = useState<DeviceUser[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDoor, setConfirmDoor] = useState(false);
  const [linking, setLinking] = useState<DeviceUser | null>(null);
  const [removing, setRemoving] = useState<DeviceUser | null>(null);
  const [showLinked, setShowLinked] = useState(false);
  const lastImport = device.lastImportAt?.getTime() ?? 0;

  useEffect(() => {
    void countDeviceUsers(device.id)
      .then(setCount)
      .catch(() => setCount(null));
  }, [device.id, lastImport]);
  const loadList = async () => {
    setLoadingList(true);
    try {
      setUsers(await loadDeviceUsers(device.id));
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setLoadingList(false);
    }
  };
  const patchUser = (pin: string, change: Partial<DeviceUser>) =>
    setUsers((list) => list?.map((u) => (u.pin === pin ? { ...u, ...change } : u)) ?? list);

  const onMachine = (users ?? []).filter((u) => !u.removed);
  const notLinked = onMachine.filter((u) => !u.linkId);
  const linked = onMachine.filter((u) => u.linkId);
  const needle = q.trim().toLowerCase();
  const matches = (u: DeviceUser) =>
    !needle || u.pin.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle);
  const shownNotLinked = notLinked.filter(matches).slice(0, 50);
  const reading = !!device.importUntil && device.importUntil.getTime() > Date.now();

  const read = async () => {
    setBusy(true);
    try {
      await readUsersFromMachine(device.id);
      toast.success("Asked the machine for its users", {
        description:
          "The list fills in over the next few minutes (about 1,000 people take 2–3 minutes).",
      });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const door = async (on: boolean) => {
    try {
      await setDoorControl(device.id, on);
      toast.success(on ? "Door control is on" : "Attendance only: nobody is locked out");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  const remove = async () => {
    if (!removing) return;
    const u = removing;
    setRemoving(null);
    try {
      await removeMachineUser(device.id, u.pin);
      patchUser(u.pin, { removed: true });
      toast.success(`ID ${u.pin} will be taken off the machine`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          {device.doorControl ? (
            <DoorClosed className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <DoorOpen className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          )}
          <div>
            <p className="font-semibold">Lock out members whose plan ended</p>
            <p className="text-meta">
              {device.doorControl
                ? "On: after midnight, members without a running plan are taken off the machine (their fingerprint is kept), and a renewal puts them back."
                : "Off (attendance only): the machine lets in everyone registered on it. Keep it off while the old software still runs; turn it on on switch-over day."}
            </p>
          </div>
        </div>
        <Switch
          checked={device.doorControl}
          onCheckedChange={(on) => (on ? setConfirmDoor(true) : void door(false))}
          aria-label="Lock out members whose plan ended"
        />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <ImageIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-semibold">Send member photos to the machine</p>
            <p className="text-meta">
              The machine takes its own photo when a thumb is registered. Turn this on only if you
              want the app's photo shown after a punch instead.
            </p>
          </div>
        </div>
        <Switch
          checked={device.sendPhotos}
          onCheckedChange={(on) =>
            void setSendPhotos(device.id, on).catch((e) => toast.error(firestoreErrorMessage(e)))
          }
          aria-label="Send member photos to the machine"
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Users on this machine</p>
            <p className="text-meta">
              {users
                ? `${onMachine.length} people · ${onMachine.filter((u) => u.hasFingerprint).length} with a fingerprint · ${linked.length} linked · ${notLinked.length} not linked`
                : count
                  ? `${count} people read from the machine`
                  : count === 0
                    ? "Not read yet. Read them once to keep the fingerprints already on the machine."
                    : "…"}
              {reading ? ` · reading until ${time.format(device.importUntil!)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {count && !users ? (
              <Button size="sm" onClick={() => loadList()} disabled={loadingList}>
                {loadingList ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Show people
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => read()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              Read users from the machine
            </Button>
          </div>
        </div>

        {users ? (
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find by machine ID or name…"
              aria-label="Find people on the machine"
            />
          </div>
        ) : null}

        {device.doorControl && notLinked.some((u) => !u.admin) ? (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            {notLinked.filter((u) => !u.admin).length} people on the machine are not linked to a
            member or staff, so the door keeps letting them in. Import your old member list (
            <Link to="/settings" search={{ tab: "data" }} className="font-semibold underline">
              Settings → Import / export
            </Link>
            ) to link them all by Member ID, or link / take them off one by one below.
          </p>
        ) : null}

        {users && notLinked.length > shownNotLinked.length ? (
          <p className="text-meta">
            Showing {shownNotLinked.length} of {notLinked.filter(matches).length} not linked. Type a
            name or ID to find someone.
          </p>
        ) : null}
        {shownNotLinked.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {shownNotLinked.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    ID {u.pin}
                    {u.name ? ` · ${u.name}` : ""}
                  </p>
                  <p className="text-meta">
                    {u.hasFingerprint
                      ? "Fingerprint on the machine"
                      : "No fingerprint on the machine"}
                    {u.admin ? " · machine admin" : ""}
                  </p>
                </div>
                <Button size="sm" onClick={() => setLinking(u)}>
                  <Link2 aria-hidden /> Link
                </Button>
                {!u.admin ? (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(u)}>
                    <UserX aria-hidden /> Take off
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {linked.length ? (
          <div>
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 text-foreground underline"
              onClick={() => setShowLinked((v) => !v)}
            >
              {showLinked ? "Hide" : "Show"} the {linked.length} linked
            </Button>
            {showLinked ? (
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {linked.filter(matches).map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 p-3">
                    <p className="min-w-0 flex-1 text-sm">
                      <b>ID {u.pin}</b>
                      {u.name ? ` (${u.name})` : ""} → {u.linkName}{" "}
                      <span className="text-meta">
                        {u.linkType === "staff" ? "staff" : "member"}
                      </span>
                    </p>
                    {u.hasFingerprint ? (
                      <StatusPill tone="success">Fingerprint kept</StatusPill>
                    ) : (
                      <StatusPill tone="warning">No fingerprint</StatusPill>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setLinking(u)}>
                      Change
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <LinkDialog
        device={device}
        user={linking}
        onClose={() => setLinking(null)}
        onLinked={patchUser}
      />
      <ConfirmDialog
        open={confirmDoor}
        onOpenChange={setConfirmDoor}
        title="Turn on door control?"
        description="Members without a running plan are taken off the machine at its next contact, and every night after that. Their fingerprint is kept, so a renewal puts them back without a new scan. Turn this on only when the old software is switched off."
        confirmLabel="Turn on"
        onConfirm={() => {
          setConfirmDoor(false);
          void door(true);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Take ID ${removing?.pin ?? ""} off the machine?`}
        description="They and their fingerprints are deleted from the machine: they can no longer open the door. Use this for people who are not members or staff here any more."
        confirmLabel="Take off"
        destructive
        {...(removing ? { typeToConfirm: removing.pin } : {})}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** Pick the member or staff member a machine ID belongs to; the machine's name is a hint. */
function LinkDialog({
  device,
  user,
  onClose,
  onLinked,
}: {
  device: BiometricDevice;
  user: DeviceUser | null;
  onClose: () => void;
  onLinked: (pin: string, change: Partial<DeviceUser>) => void;
}) {
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const needle = (q || user?.name || "").trim().toLowerCase();
    const words = needle.split(/\s+/).filter((w) => w.length > 1);
    const score = (name: string, code: string) =>
      (code === user?.pin ? 5 : 0) + words.filter((w) => name.toLowerCase().includes(w)).length;
    const list = [
      ...staff.data
        .filter((s) => s.active)
        .map((s) => ({
          kind: "staff" as const,
          id: s.id,
          name: s.name,
          sub: `Staff · ${s.role}`,
          code: "",
          taken: s.biometricUserId,
        })),
      ...clients.data.map((c) => ({
        kind: "client" as const,
        id: c.id,
        name: c.fullName,
        sub: `Member ID ${c.clientCode} · ${c.phone}`,
        code: c.clientCode,
        taken: c.biometricUserId,
      })),
    ].map((o) => ({ ...o, score: score(o.name, o.code) }));
    const shown = q
      ? list.filter((o) => `${o.name} ${o.sub}`.toLowerCase().includes(q.toLowerCase()))
      : list.filter((o) => o.score > 0);
    return shown.sort((a, b) => b.score - a.score).slice(0, 30);
  }, [q, user, clients.data, staff.data]);

  const link = async (to: { clientId?: string; staffId?: string }, label: string, name = "") => {
    if (!user) return;
    setSaving(true);
    try {
      await linkMachineUser(device.id, user.pin, to);
      onLinked(
        user.pin,
        to.clientId
          ? { linkId: to.clientId, linkType: "client", linkName: name }
          : to.staffId
            ? { linkId: to.staffId, linkType: "staff", linkName: name }
            : { linkId: "", linkType: "", linkName: "" },
      );
      toast.success(label);
      setQ("");
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      title={`Who is machine ID ${user?.pin ?? ""}?`}
      description={`Name on the machine: ${user?.name || "none"}. ${user?.hasFingerprint ? "Their fingerprint is kept, so they don't scan again." : "No fingerprint on the machine yet."}`}
      footer={
        <>
          {user?.linkId ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => link({}, `ID ${user.pin} unlinked`)}
            >
              Unlink
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search member or staff name, ID or phone…"
            aria-label="Search member or staff"
          />
        </div>
        {!q && options.length ? (
          <p className="text-meta">Suggested from the machine name and ID:</p>
        ) : null}
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {options.map((o) => {
            const busyElsewhere = !!o.taken && o.taken !== user?.pin;
            return (
              <li key={`${o.kind}-${o.id}`}>
                <button
                  type="button"
                  disabled={saving || busyElsewhere}
                  onClick={() =>
                    void link(
                      o.kind === "staff" ? { staffId: o.id } : { clientId: o.id },
                      `ID ${user?.pin} linked to ${o.name}`,
                      o.name,
                    )
                  }
                  className={cn(
                    "w-full p-3 text-left hover:bg-accent",
                    busyElsewhere && "opacity-50",
                  )}
                >
                  <span className="block font-semibold">{o.name}</span>
                  <span className="text-meta">
                    {o.sub}
                    {busyElsewhere ? ` · already machine ID ${o.taken}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
          {!options.length ? (
            <li className="p-3 text-sm text-muted-foreground">
              {q ? "Nobody found." : "Type a name, member ID or phone to search."}
            </li>
          ) : null}
        </ul>
      </div>
    </FormDialog>
  );
}
