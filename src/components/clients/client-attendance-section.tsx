import { useMemo } from "react";
import { format } from "date-fns";
import { CalendarCheck, Fingerprint, ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Shimmer } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import { ACCESS_REASON_LABELS, EVENT_LABELS } from "@/lib/attendance-utils";
import { decideMemberAccess } from "@/services/access-decision.service";
import { subscribeClientAttendance } from "@/services/attendance.service";
import { updateClient } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { AttendanceEvent, Client, Membership } from "@/types/models";

export function ClientAttendanceSection({
  client,
  memberships,
}: {
  client: Client;
  memberships: Membership[];
}) {
  const events = useLive<AttendanceEvent[]>(
    (ok, fail) => subscribeClientAttendance(client.id, ok, fail),
    [],
    [client.id],
  );
  const { resumeSetup } = useEnrollment();
  const decision = useMemo(
    () => decideMemberAccess(client, memberships, true),
    [client, memberships],
  );
  const visits = events.data.filter(
    (e) => e.eventType === "check_in" && e.accessDecision === "allowed",
  );
  const blocked = client.biometricStatus === "disabled";

  const toggleEntry = async () => {
    try {
      await updateClient(client.id, { biometricStatus: blocked ? "active" : "disabled" });
      toast.success(blocked ? "Entry allowed again" : "Entry blocked for this member");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {decision.allowed ? (
              <ShieldCheck className="size-8 text-success" aria-hidden />
            ) : (
              <ShieldX className="size-8 text-destructive" aria-hidden />
            )}
            <div>
              <p className="text-card-title">
                {decision.allowed ? "Entry allowed" : "Entry blocked"}
              </p>
              <p className="text-meta">
                {!client.firstThumbRegistered
                  ? "Thumb not registered yet"
                  : blocked
                    ? "Blocked by staff"
                    : ACCESS_REASON_LABELS[decision.reason]}
                {client.biometricUserId ? ` · ID ${client.biometricUserId} on device` : ""}
                {client.deviceAccess === "removed" ? " · removed from the door device" : ""}
              </p>
            </div>
          </div>
          {!client.firstThumbRegistered ? (
            <Button onClick={() => resumeSetup(client)}>
              <Fingerprint aria-hidden /> Register thumb
            </Button>
          ) : (
            <Button variant={blocked ? "default" : "outline"} onClick={() => void toggleEntry()}>
              {blocked ? "Allow entry" : "Block entry"}
            </Button>
          )}
        </div>
      </section>

      {events.loading ? (
        <Shimmer className="h-36 rounded-xl" />
      ) : events.error ? (
        <ErrorState error={events.error} title="Couldn't load visits" />
      ) : (
        <section className="surface-card p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-meta">Last visit</p>
              <p className="font-bold">
                {visits[0] ? format(visits[0].timestamp, "dd MMM, hh:mm a") : "—"}
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-meta">Total visits</p>
              <p className="font-bold">{visits.length}</p>
            </div>
          </div>
          <h3 className="text-card-title mt-5">Recent visits</h3>
          {events.data.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="No visits yet"
              description="Thumb scans at the entrance appear here automatically."
            />
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {events.data.slice(0, 20).map((e) => (
                <li className="flex items-center justify-between gap-3 py-3" key={e.id}>
                  <div className="min-w-0">
                    <p className="font-semibold">{format(e.timestamp, "dd MMM, hh:mm a")}</p>
                    <p className="text-meta">
                      {EVENT_LABELS[e.eventType]} ·{" "}
                      {e.source === "manual" ? "entered by staff" : e.deviceNameSnapshot}
                    </p>
                  </div>
                  <StatusPill tone={e.accessDecision === "allowed" ? "success" : "danger"}>
                    {e.accessDecision === "allowed"
                      ? "allowed"
                      : ACCESS_REASON_LABELS[e.accessReason]}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
