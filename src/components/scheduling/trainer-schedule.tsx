import { useState } from "react";
import { StatusPill } from "@/components/common/status-pill";
import { Input } from "@/components/ui/input";
import { useLive } from "@/hooks/use-live-query";
import { BOOKING_STATUS_META, formatTime, todayISO } from "@/lib/format";
import { subscribeTrainers } from "@/services/pt.service";
import type { Booking, Trainer } from "@/types/models";

/** One day, every trainer: which time slots are booked with whom, so staff can see free slots. */
export function TrainerSchedule({ bookings }: { bookings: Booking[] }) {
  const trainers = useLive<Trainer[]>(subscribeTrainers, [], []);
  const [date, setDate] = useState(todayISO());
  const active = trainers.data.filter((t) => t.status === "active");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="Day"
          value={date}
          onChange={(e) => setDate(e.target.value || todayISO())}
          className="w-auto"
        />
        <span className="text-meta">Booked PT slots per trainer. Anything not listed is free.</span>
      </div>
      {!active.length ? (
        <p className="text-meta">Add trainers in Packages &amp; Trainers.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {active.map((t) => {
            const slots = bookings
              .filter(
                (b) =>
                  b.bookingType === "pt" &&
                  b.trainerId === t.id &&
                  b.date === date &&
                  b.status !== "cancelled",
              )
              .sort((a, b) => a.startTime.localeCompare(b.startTime));
            return (
              <section key={t.id} className="surface-card p-4">
                <h3 className="text-card-title">{t.name}</h3>
                <p className="text-meta">
                  {slots.length
                    ? `${slots.length} session${slots.length === 1 ? "" : "s"}`
                    : "Free all day"}
                </p>
                <ul className="mt-3 space-y-2">
                  {slots.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold tabular-nums">
                        {formatTime(b.startTime)} – {formatTime(b.endTime)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{b.clientNameSnapshot}</span>
                      <StatusPill tone={BOOKING_STATUS_META[b.status].tone}>
                        {BOOKING_STATUS_META[b.status].label}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
