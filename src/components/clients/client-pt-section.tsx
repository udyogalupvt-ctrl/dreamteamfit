import { Dumbbell, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { StatusPill } from "@/components/common/status-pill";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatPrice, todayISO } from "@/lib/format";
import { subscribeDevices } from "@/services/biometric-devices.service";
import { subscribeClientPtAssignments } from "@/services/pt.service";
import { subscribeClientBookings } from "@/services/bookings.service";
import { PtSessionDialog } from "@/components/scheduling/pt-session-dialog";
import { BOOKING_STATUS_META, formatTime } from "@/lib/format";
import { useState } from "react";
import { subscribeClientPayments } from "@/services/finance.service";
import type { BiometricDevice, Booking, Client, Payment, PtAssignment } from "@/types/models";

export function ClientPtSection({ client }: { client: Client }) {
  const pts = useLive(
    (ok, fail) => subscribeClientPtAssignments(client.id, ok, fail),
    [] as PtAssignment[],
    [client.id],
  );
  const { openEnrollment } = useEnrollment();
  const [booking, setBooking] = useState(false);
  const sessions = useLive(
    (ok, fail) => subscribeClientBookings(client.id, ok, fail),
    [] as Booking[],
    [client.id],
  );
  const pt = sessions.data.filter((b) => b.bookingType === "pt").reverse();
  if (!pts.loading && !pts.data.length)
    return (
      <EmptyState
        icon={Dumbbell}
        title="No personal training"
        description="Add PT through a new membership checkout."
        action={
          <Button onClick={() => openEnrollment({ existingClient: client })}>
            Add package / PT
          </Button>
        }
      />
    );
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setBooking(true)}>
          <Dumbbell /> Book PT session
        </Button>
      </div>
      {pts.data.map((p) => (
        <article key={p.id} className="surface-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{p.ptPackageNameSnapshot}</p>
            <StatusPill
              tone={p.status === "active" ? "success" : p.status === "pending" ? "warning" : "info"}
            >
              {p.status === "pending" ? "Pending biometric" : p.status}
            </StatusPill>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Trainer", p.trainerNameSnapshot],
              ["Price", formatPrice(p.ptPrice)],
              [
                "Trainer share",
                `${formatPrice(p.trainerShareAmount)} (${p.trainerShareType === "percentage" ? `${p.trainerShareValue}%` : "fixed"})`,
              ],
              ["Gym share", formatPrice(p.gymShareAmount)],
              ["Start", formatDateISO(p.startDate)],
              ["End", formatDateISO(p.endDate)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-meta">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
      <section className="surface-card overflow-hidden">
        <h3 className="text-card-title border-b border-border p-4">PT session history</h3>
        {!pt.length ? (
          <p className="p-4 text-sm text-muted-foreground">No PT sessions yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {pt.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
              >
                <span>
                  <b>{formatDateISO(b.date)}</b> · {formatTime(b.startTime)} –{" "}
                  {formatTime(b.endTime)} · {b.trainerNameSnapshot}
                  {b.trainerOverride ? ` (assigned ${b.assignedTrainerNameSnapshot})` : ""}
                </span>
                <StatusPill tone={BOOKING_STATUS_META[b.status].tone}>
                  {BOOKING_STATUS_META[b.status].label}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PtSessionDialog open={booking} onOpenChange={setBooking} initialClient={client} />
    </div>
  );
}

/**
 * Entry by thumb, as the machine really has it. A member may enter with a running gym plan or a
 * running PT plan (same rule as the server). In "Attendance only" (door control off) nobody is
 * taken off the machine when a plan ends; only "Block entry" does.
 */
export function ClientBiometricCard({ client }: { client: Client }) {
  const { resumeSetup } = useEnrollment();
  const pts = useLive(
    (ok, fail) => subscribeClientPtAssignments(client.id, ok, fail),
    [] as PtAssignment[],
    [client.id],
  );
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const today = todayISO();
  const device = devices.data.find((d) => d.id === client.biometricDeviceId);
  const plan = client.currentMembership;
  const planRuns = plan?.status === "active" && (!plan.endDate || plan.endDate >= today);
  const ptRuns = pts.data.some(
    (p) => p.status === "active" && p.startDate <= today && p.endDate >= today,
  );
  const entitled =
    client.biometricStatus === "active" && client.firstThumbRegistered && (planRuns || ptRuns);
  const onMachine = client.firstThumbRegistered && client.deviceAccess !== "removed";
  const doorOff = !!device && !device.doorControl;
  const [label, tone, note] = !client.firstThumbRegistered
    ? ["No thumb yet", "warning", ""]
    : entitled && onMachine
      ? ["Can enter", "success", ptRuns && !planRuns ? "Entry through the running PT plan." : ""]
      : entitled
        ? ["Being added back", "warning", "Goes back on the machine at its next check-in."]
        : !onMachine
          ? ["Blocked on the machine", "danger", ""]
          : doorOff
            ? [
                "No plan · can still enter",
                "warning",
                "The machine is in Attendance only mode: ended or cancelled plans are not locked out. Fingerprint Devices → the machine → turn on Door control.",
              ]
            : [
                "Being removed",
                "warning",
                "Taken off the machine at its next check-in (within a minute).",
              ];
  return (
    <section className="surface-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-card-title flex items-center gap-2">
          <Fingerprint className="size-4" /> Entry (thumb)
        </h2>
        <StatusPill tone={tone as "success" | "warning" | "danger"}>{label}</StatusPill>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {[
          ["Thumb", client.firstThumbRegistered ? "Registered" : "Not registered"],
          ["ID on device", client.biometricUserId || "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-meta">{k}</dt>
            <dd className="font-semibold capitalize">{v}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="text-meta mt-3">{note}</p> : null}
      {!client.firstThumbRegistered ? (
        <Button className="mt-4" onClick={() => resumeSetup(client)}>
          <Fingerprint /> Register thumb
        </Button>
      ) : null}
    </section>
  );
}

export function ClientPaymentsList({ clientId }: { clientId: string }) {
  const pays = useLive((ok, fail) => subscribeClientPayments(clientId, ok, fail), [] as Payment[], [
    clientId,
  ]);
  if (!pays.data.length) return null;
  return (
    <section className="surface-card overflow-hidden">
      <h3 className="text-card-title border-b border-border p-4">Payments</h3>
      <ul className="divide-y divide-border">
        {pays.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <span>
              <b>{formatPrice(p.amount)}</b> · {p.method} · {formatDateISO(p.paymentDate)}{" "}
              <span className="text-meta">
                ({p.kind === "balance" ? "balance payment" : "at checkout"} · {p.invoiceNumber})
              </span>
            </span>
            <span className="text-meta">
              {p.ptGymAmount || p.trainerShareAmount
                ? `PT gym ${formatPrice(p.ptGymAmount)} · trainer ${formatPrice(p.trainerShareAmount)}`
                : `Membership ${formatPrice(p.membershipGymAmount)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
