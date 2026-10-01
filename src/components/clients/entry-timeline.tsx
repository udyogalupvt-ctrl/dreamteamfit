import { format } from "date-fns";
import { CheckCircle2, Circle, Loader2, TriangleAlert } from "lucide-react";
import { useLive } from "@/hooks/use-live-query";
import { useNow } from "@/lib/thumb-phase";
import { cn } from "@/lib/utils";
import {
  deviceConnection,
  subscribeClientBiometricCommands,
  subscribeDevices,
} from "@/services/biometric-devices.service";
import type { BiometricCommand, BiometricDevice, Client } from "@/types/models";

type Step = { label: string; at: Date | null; state: "done" | "waiting" | "failed"; note?: string };

const time = (d: Date) => format(d, "hh:mm:ss a");
const secs = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
const took = (n: number) =>
  n < 60 ? `${n} second${n === 1 ? "" : "s"}` : `${Math.floor(n / 60)} min ${n % 60} s`;

/**
 * What happened after the last Block entry / Allow entry, with the machine's real times: when it
 * was pressed, when the machine checked in, and when the member was taken off (or put back on)
 * the machine, and how many seconds that took. Live while it is still on its way.
 */
export function EntryTimeline({ client }: { client: Client }) {
  const now = useNow(1000);
  const commands = useLive<BiometricCommand[]>(
    (ok, fail) => subscribeClientBiometricCommands(client.id, ok, fail),
    [],
    [client.id],
  );
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const pressedAt = client.entryChangedAt;
  if (!pressedAt || !client.biometricUserId) return null;
  // A change older than a day is history: the status above says where things stand.
  if (now - pressedAt.getTime() > 24 * 3600_000) return null;

  const block = client.biometricStatus === "disabled";
  const since = pressedAt.getTime() - 3000;
  const mine = commands.data
    .filter((c) => c.createdAt.getTime() >= since && c.status !== "cancelled")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const check = mine.find((c) => (c.type as string) === "door_check");
  const thumbCopy = mine.find((c) => c.type === "query_fp" && !c.door);
  const machine = mine.filter(
    (c) =>
      c.door && (block ? c.type === "delete_user" : ["user_upsert", "restore_fp"].includes(c.type)),
  );
  // Put back without a saved thumb: the member has to register it again at the counter.
  const noThumb = !block && machine.length > 0 && !machine.some((c) => c.type === "restore_fp");
  const device = devices.data.find((d) => d.id === client.biometricDeviceId);
  const online = device ? deviceConnection(device, now).online : true;

  const steps: Step[] = [
    {
      label: `${block ? "Block entry" : "Allow entry"} pressed${client.entryChangedBy ? ` by ${client.entryChangedBy}` : ""}`,
      at: pressedAt,
      state: "done",
    },
  ];
  // The machine's check-in where the server worked out what to do.
  steps.push(
    check?.status === "done" || check?.status === "failed"
      ? { label: "Machine checked in", at: check.completedAt, state: "done" }
      : {
          label: "Waiting for the machine to check in",
          at: null,
          state: "waiting",
          note: `${Math.round((now - pressedAt.getTime()) / 1000)} s so far · it checks in about every 15 s`,
        },
  );
  const withoutCopy = machine.some((c) => c.noThumbCopy);
  if (block && thumbCopy)
    steps.push(
      withoutCopy
        ? {
            label: "The machine did not send a copy of the thumb",
            at: thumbCopy.completedAt,
            state: "done",
            note: "Blocked anyway. After Allow entry, the thumb has to be registered again.",
          }
        : thumbCopy.status === "done"
          ? {
              label: "Copy of the thumb saved (so Allow entry needs no new scan)",
              at: thumbCopy.completedAt,
              state: "done",
            }
          : thumbCopy.status === "failed"
            ? {
                label: "The machine did not send a copy of the thumb",
                at: null,
                state: "waiting",
                note: "Blocking anyway at the next check-in.",
              }
            : { label: "Saving a copy of the thumb first", at: null, state: "waiting" },
    );
  const last = machine[machine.length - 1];
  const failed = machine.find((c) => c.status === "failed");
  const finishedAt =
    last && machine.every((c) => c.status === "done") ? (last.completedAt ?? null) : null;
  if (failed)
    steps.push({
      label: "The machine refused the change",
      at: null,
      state: "failed",
      note: failed.error,
    });
  else if (finishedAt)
    steps.push({
      label: block
        ? "Taken off the machine: the door no longer opens"
        : noThumb
          ? "Added back to the machine, but no saved thumb: register the thumb again"
          : "Put back on the machine with the saved thumb",
      at: finishedAt,
      state: "done",
      note: `took ${took(secs(pressedAt, finishedAt))} after pressing ${block ? "Block" : "Allow"} entry`,
    });
  else if (machine.length)
    steps.push({
      label: block ? "Removing from the machine" : "Putting back on the machine",
      at: null,
      state: "waiting",
      ...(machine.some((c) => c.status === "sent")
        ? { note: "sent, waiting for the machine to confirm" }
        : {}),
    });
  else if (check?.status === "done" && !thumbCopy)
    // The machine was already in the wanted state (e.g. off already because the plan ended).
    steps.push({
      label: block
        ? client.deviceAccess === "removed"
          ? "Already off the machine: nothing to change"
          : "Not taken off the machine"
        : client.deviceAccess === "removed"
          ? "Stays off the machine: no running plan"
          : "Already on the machine: nothing to change",
      at: null,
      state: "done",
    });

  return (
    <div
      className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm"
      aria-live="polite"
    >
      <p className="text-label mb-2">On the fingerprint machine</p>
      {!online && !finishedAt ? (
        <p className="mb-2 flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-warning-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            {device?.name ?? "The machine"} is offline
            {device?.lastSeenAt
              ? ` (last contact ${format(device.lastSeenAt, "dd MMM, hh:mm a")})`
              : ""}
            . It happens as soon as the machine is back online.
          </span>
        </p>
      ) : null}
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            {s.state === "done" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            ) : s.state === "failed" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            ) : i === steps.length - 1 ? (
              <Loader2
                className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={cn("min-w-0", s.state === "failed" && "text-destructive")}>
              <span className="font-medium">{s.label}</span>
              {s.at ? <span className="tabular-nums"> · {time(s.at)}</span> : null}
              {s.note ? <span className="text-meta block">{s.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
