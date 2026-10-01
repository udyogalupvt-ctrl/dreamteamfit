import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Fingerprint, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { PhaseMessage } from "@/components/biometrics/fingerprint-panel";
import { phaseOf, useNow } from "@/lib/thumb-phase";
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
import { useLive } from "@/hooks/use-live-query";
import { deviceConnection, subscribeDevices } from "@/services/biometric-devices.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  cancelStaffFingerprintRequest,
  freeStaffMachineId,
  requestStaffFingerprint,
  subscribeStaffCommands,
} from "@/services/staff.service";
import type { BiometricCommand, BiometricDevice, Staff } from "@/types/models";

/**
 * A staff member's thumb on the fingerprint machine, the same way as a member's: the screen
 * follows its own request, says what the machine is doing (with a live seconds count), and the
 * staff member counts as registered only when the machine itself sends the thumb.
 */
export function StaffThumbDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const now = useNow(1000);
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const usable = useMemo(
    () =>
      devices.data
        .filter((d) => d.integrationType === "adms" && d.status !== "disabled")
        .sort((a, b) => Number(deviceConnection(b).online) - Number(deviceConnection(a).online)),
    [devices.data],
  );
  const cmds = useLive<BiometricCommand[]>(
    staff ? (ok, fail) => subscribeStaffCommands(staff.id, ok, fail) : null,
    [],
    [staff?.id],
  );
  const [deviceId, setDeviceId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  // Only this window's request drives the status; old attempts stay in history.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestedAfter, setRequestedAfter] = useState(() => Date.now() - 15 * 60 * 1000);

  useEffect(() => {
    setRequestId(null);
    setRequestedAfter(Date.now() - 15 * 60 * 1000);
    setAgain(false);
    setPin("");
    setDeviceId(staff?.biometricDeviceId ?? "");
  }, [staff?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!deviceId && usable[0]) setDeviceId(usable[0].id);
  }, [usable, deviceId]);
  // A free machine ID, once the machine (and so its own user list) is known.
  useEffect(() => {
    if (!staff || pin || !deviceId) return;
    void freeStaffMachineId(deviceId, staff.id, staff.biometricUserId).then((v) =>
      setPin((p) => p || v),
    );
  }, [staff, pin, deviceId]);

  const device = usable.find((d) => d.id === deviceId) ?? null;
  const connection = device ? deviceConnection(device, now) : null;
  const phase = phaseOf(cmds.data, requestedAfter, requestId);
  const [step, setStep] = useState({ kind: phase.kind as string, at: Date.now() });
  useEffect(() => {
    if (step.kind !== phase.kind) setStep({ kind: phase.kind, at: Date.now() });
  }, [phase.kind, step.kind]);
  const stepAt = step.kind === phase.kind ? step.at : Date.now();
  const active =
    phase.kind === "waiting_device" ||
    phase.kind === "place_thumb" ||
    (phase.kind === "confirming" && now - stepAt < 90_000);
  const registered = Boolean(staff?.firstThumbRegistered) && !again;

  const start = async () => {
    if (!staff || !device || !pin) return;
    setBusy(true);
    try {
      setRequestId(null);
      setRequestedAfter(Date.now() - 5000);
      const id = await requestStaffFingerprint(staff, device, pin);
      setRequestId(id);
      setAgain(false);
      toast.success("Sent to the machine", {
        description: "Ask them to place the right thumb on the scanner 3 times.",
      });
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!staff) return;
    try {
      await cancelStaffFingerprintRequest(staff.id);
      setRequestId(null);
      setRequestedAfter(Date.now());
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  return (
    <FormDialog
      open={!!staff}
      onOpenChange={(o) => !o && onClose()}
      title={`Thumb · ${staff?.name ?? ""}`}
      description="Staff use the same fingerprint machine. Their punches are staff attendance and always open the door while they work here."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {registered ? (
            <Button
              variant="outline"
              onClick={() => {
                setAgain(true);
                setRequestId(null);
                setRequestedAfter(Date.now());
              }}
            >
              <RotateCcw aria-hidden /> Register again
            </Button>
          ) : active ? (
            <Button variant="outline" onClick={() => cancel()}>
              <X aria-hidden /> Cancel request
            </Button>
          ) : (
            <Button disabled={busy || !device || !pin} onClick={() => start()}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : phase.kind === "failed" ? (
                <RotateCcw aria-hidden />
              ) : (
                <Fingerprint aria-hidden />
              )}
              {phase.kind === "failed" ? "Try again" : "Register thumb on machine"}
            </Button>
          )}
        </>
      }
    >
      {registered && staff ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-6 text-center">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <p className="text-card-title">Thumb registered · ID {staff.biometricUserId}</p>
          <p className="text-meta max-w-sm">
            Confirmed by the machine. Their punches now count as staff attendance.
          </p>
        </div>
      ) : devices.loading ? (
        <Loader2 className="animate-spin" aria-label="Loading machines" />
      ) : !usable.length ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
          <p>
            No cloud fingerprint machine is connected yet.{" "}
            <Link to="/biometric-devices" className="font-semibold underline">
              Connect it in Fingerprint Devices
            </Link>
            , then come back here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Machine" htmlFor="th-dev">
              <Select value={deviceId} onValueChange={setDeviceId} disabled={active}>
                <SelectTrigger id="th-dev" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} · {deviceConnection(d, now).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="ID on the machine"
              htmlFor="th-pin"
              hint="Staff IDs start at 9001 so they never clash with members."
            >
              <Input
                id="th-pin"
                inputMode="numeric"
                value={pin}
                disabled={active}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 9))}
              />
            </Field>
          </div>
          {connection && !connection.online ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <b>{device?.name}</b> is {connection.label.toLowerCase()}. Check the machine is on and
              connected to the internet.
            </p>
          ) : null}
          <PhaseMessage
            phase={phase}
            waitedSec={Math.max(0, Math.round((now - stepAt) / 1000))}
            person="the staff member"
          />
        </div>
      )}
    </FormDialog>
  );
}
