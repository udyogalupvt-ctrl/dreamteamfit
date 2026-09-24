import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Fingerprint, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
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
import { cn } from "@/lib/utils";
import {
  deviceConnection,
  subscribeClientBiometricCommands,
  subscribeDevices,
} from "@/services/biometric-devices.service";
import { subscribeClient } from "@/services/clients.service";
import {
  cancelFingerprintRequest,
  requestFingerprint,
  suggestBiometricUserId,
} from "@/services/enrollment.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { BiometricCommand, BiometricDevice, Client } from "@/types/models";

/** Re-render every few seconds so "online" and "waiting" timers stay honest. */
function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

type Phase =
  | { kind: "idle" }
  | { kind: "waiting_device"; since: Date }
  | { kind: "place_thumb" }
  | { kind: "confirming"; since: Date }
  | { kind: "failed"; message: string };

function phaseOf(commands: BiometricCommand[], requestedAfter: number): Phase {
  const enroll = commands.find(
    (c) => c.type === "enroll_fp" && c.createdAt.getTime() >= requestedAfter,
  );
  if (!enroll || enroll.status === "cancelled") return { kind: "idle" };
  if (enroll.status === "pending") {
    const upsert = commands.find(
      (c) => c.type === "user_upsert" && c.status === "failed" && c.createdAt >= enroll.createdAt,
    );
    if (upsert) return { kind: "failed", message: upsert.error };
    return { kind: "waiting_device", since: enroll.createdAt };
  }
  if (enroll.status === "sent") return { kind: "place_thumb" };
  if (enroll.status === "done")
    return { kind: "confirming", since: enroll.completedAt ?? enroll.updatedAt };
  return { kind: "failed", message: enroll.error || "The device could not capture the thumb." };
}

export function FingerprintPanel({
  clientId,
  enrollmentId,
  onRegistered,
}: {
  clientId: string;
  enrollmentId: string | null;
  onRegistered?: () => void;
}) {
  const now = useNow();
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const client = useLive<Client | null>((ok, fail) => subscribeClient(clientId, ok, fail), null, [
    clientId,
  ]);
  const commands = useLive<BiometricCommand[]>(
    (ok, fail) => subscribeClientBiometricCommands(clientId, ok, fail),
    [],
    [clientId],
  );
  const usable = useMemo(
    () =>
      devices.data
        .filter((d) => d.status !== "disabled" && d.integrationType !== "manual")
        .sort((a, b) => Number(deviceConnection(b).online) - Number(deviceConnection(a).online)),
    [devices.data],
  );
  const [deviceId, setDeviceId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Only commands from this session's request drive the status; old attempts stay in history.
  const [requestedAfter, setRequestedAfter] = useState(() => Date.now() - 15 * 60 * 1000);

  useEffect(() => {
    if (!deviceId && usable[0]) setDeviceId(usable[0].id);
  }, [usable, deviceId]);
  useEffect(() => {
    if (pin || !client.data) return;
    if (client.data.biometricUserId) setPin(client.data.biometricUserId);
    // Same number as the member ID, so staff only deal with one number.
    else if (/^\d+$/.test(client.data.clientCode)) setPin(client.data.clientCode);
    else void suggestBiometricUserId().then((v) => setPin((p) => p || v));
  }, [client.data, pin]);

  const registered = Boolean(client.data?.firstThumbRegistered);
  useEffect(() => {
    if (registered) onRegistered?.();
  }, [registered, onRegistered]);

  const device = usable.find((d) => d.id === deviceId) ?? null;
  const connection = device ? deviceConnection(device, now) : null;
  const phase = phaseOf(commands.data, requestedAfter);
  const active =
    phase.kind === "waiting_device" ||
    phase.kind === "place_thumb" ||
    (phase.kind === "confirming" && now - phase.since.getTime() < 90_000);

  const start = async () => {
    if (!device || !pin.trim()) return;
    setBusy(true);
    setNote("");
    try {
      setRequestedAfter(Date.now() - 5000);
      const r = await requestFingerprint({ clientId, enrollmentId, device, biometricUserId: pin });
      if (r.mode === "device") toast.success("Sent to the device", { description: r.message });
      else {
        setNote(r.message);
        if (r.ok) toast.success("Thumb registered");
        else toast.error("Thumb not registered", { description: r.message });
      }
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    try {
      await cancelFingerprintRequest(clientId);
      setRequestedAfter(Date.now());
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  if (registered)
    return (
      <div className="grid place-items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-6 text-center">
        <CheckCircle2 className="size-12 text-success" aria-hidden />
        <p className="text-card-title">Thumb registered</p>
        <p className="text-meta max-w-sm">
          Confirmed by the device. Membership is active and the member can enter.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Fingerprint className="size-5" aria-hidden />
        <p className="text-card-title">Register first thumb</p>
        <StatusPill tone="warning">Not registered</StatusPill>
      </div>

      {devices.loading ? (
        <Loader2 className="animate-spin" aria-label="Loading devices" />
      ) : !usable.length ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">No fingerprint device is connected yet.</p>
            <p>
              The payment is saved and the plan runs from its start date. The door opens for the
              member once the thumb is registered.{" "}
              <Link to="/biometric-devices" className="font-semibold underline">
                Connect your device
              </Link>{" "}
              (one-time setup), then come back here.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device" htmlFor="fp-device">
              <Select value={deviceId} onValueChange={setDeviceId} disabled={active}>
                <SelectTrigger id="fp-device" className="w-full">
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
              label="Member ID on device"
              htmlFor="fp-pin"
              hint="A number no one else uses on the device."
            >
              <Input
                id="fp-pin"
                inputMode="numeric"
                value={pin}
                disabled={active}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 9))}
              />
            </Field>
          </div>

          {connection && !connection.online && device?.integrationType === "adms" ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <b>{device.name}</b> is {connection.label.toLowerCase()}. Check the device is on and
              connected to the internet.
            </p>
          ) : null}

          <PhaseMessage phase={phase} now={now} />
          {note ? <p className="rounded-lg bg-muted p-3 text-sm">{note}</p> : null}

          <div className="flex flex-wrap gap-2">
            {active ? (
              <Button variant="outline" onClick={() => void cancel()}>
                <X aria-hidden /> Cancel request
              </Button>
            ) : (
              <Button size="lg" disabled={!device || busy || !pin} onClick={() => void start()}>
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : phase.kind === "failed" ? (
                  <RotateCcw aria-hidden />
                ) : (
                  <Fingerprint aria-hidden />
                )}
                {phase.kind === "failed" ? "Try again" : "Register thumb on device"}
              </Button>
            )}
          </div>
        </>
      )}
      <p className="text-meta">
        The member is activated only when the device itself confirms the thumb. Until then entry
        stays blocked.
      </p>
    </div>
  );
}

function PhaseMessage({ phase, now }: { phase: Phase; now: number }) {
  if (phase.kind === "idle") return null;
  const tone =
    phase.kind === "failed"
      ? "border-destructive/40 bg-destructive/10"
      : phase.kind === "place_thumb"
        ? "border-primary bg-primary/15"
        : "border-border bg-muted/60";
  const waitedSec =
    phase.kind === "waiting_device" || phase.kind === "confirming"
      ? Math.round((now - phase.since.getTime()) / 1000)
      : 0;
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm", tone)}>
      {phase.kind === "failed" ? (
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      ) : phase.kind === "place_thumb" ? (
        <Fingerprint className="mt-0.5 size-6 shrink-0 animate-pulse" aria-hidden />
      ) : (
        <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin" aria-hidden />
      )}
      <div>
        {phase.kind === "waiting_device" ? (
          <>
            <p className="font-semibold">Waiting for the device…</p>
            <p className="text-meta">
              It checks for new requests every ~10 seconds.
              {waitedSec > 45 ? " Taking longer than usual — make sure the device is online." : ""}
            </p>
          </>
        ) : phase.kind === "place_thumb" ? (
          <>
            <p className="text-base font-bold">
              Ask the member to place their RIGHT THUMB on the scanner
            </p>
            <p>Press 3 times, lifting the thumb between presses, until the device beeps OK.</p>
          </>
        ) : phase.kind === "confirming" ? (
          <>
            <p className="font-semibold">Thumb captured — waiting for the device to confirm…</p>
            {waitedSec > 60 ? (
              <p className="text-meta">
                Still waiting. On the device, open Comm → Cloud Server and make sure fingerprint
                upload is on, or press Try again.
              </p>
            ) : null}
          </>
        ) : (
          <p className="font-semibold">{phase.message}</p>
        )}
      </div>
    </div>
  );
}
