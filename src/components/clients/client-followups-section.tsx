import { useState } from "react";
import { CalendarClock, Phone, Plus } from "lucide-react";
import { FollowUpDialog } from "@/components/followups/followup-dialog";
import { RecordFollowUpDialog } from "@/components/leads/record-followup-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Shimmer } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatTime, todayISO } from "@/lib/format";
import { subscribeClientFollowUps } from "@/services/followups.service";
import type { Client, FollowUp } from "@/types/models";

export function ClientFollowUpsSection({ client }: { client: Client }) {
  const live = useLive<FollowUp[]>(
    (ok, fail) => subscribeClientFollowUps(client.id, ok, fail),
    [],
    [client.id],
  );
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<FollowUp | null>(null);
  const today = todayISO();
  if (live.loading) return <Shimmer className="h-40 rounded-xl" />;
  if (live.error) return <ErrorState error={live.error} title="Couldn't load follow-ups" />;
  const groups = [
    ["Due", live.data.filter((x) => x.status === "pending" && x.followUpDate <= today)],
    ["Upcoming", live.data.filter((x) => x.status === "pending" && x.followUpDate > today)],
    ["Past", live.data.filter((x) => x.status !== "pending")],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Schedule a call
        </Button>
      </div>
      {live.data.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No calls scheduled"
          description="Schedule a renewal or check-in call with this member."
        />
      ) : (
        groups.map(([title, items]) =>
          items.length ? (
            <section className="surface-card p-4 sm:p-5" key={title}>
              <h2 className="text-card-title">{title}</h2>
              <ul className="mt-2 divide-y divide-border">
                {items.map((x) => (
                  <li key={x.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{x.nextAction || x.reason}</p>
                      <p className="text-meta">
                        {formatDateISO(x.followUpDate)} · {formatTime(x.followUpTime)}
                        {x.outcome ? ` · ${x.outcome}` : ""}
                        {x.notes ? ` · “${x.notes}”` : ""}
                      </p>
                    </div>
                    {x.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <a href={`tel:${client.phone}`}>
                            <Phone aria-hidden /> Call
                          </a>
                        </Button>
                        <Button size="sm" onClick={() => setRecording(x)}>
                          Record call
                        </Button>
                      </div>
                    ) : (
                      <StatusPill tone={x.status === "completed" ? "success" : "warning"}>
                        {x.status}
                      </StatusPill>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )
      )}
      <FollowUpDialog
        open={open}
        onOpenChange={setOpen}
        clients={[client]}
        initialClient={client}
      />
      <RecordFollowUpDialog
        target={
          recording
            ? {
                inquiryId: null,
                clientId: client.id,
                name: client.fullName,
                phone: client.phone,
                currentFollowUpId: recording.id,
              }
            : null
        }
        onClose={() => setRecording(null)}
      />
    </div>
  );
}
