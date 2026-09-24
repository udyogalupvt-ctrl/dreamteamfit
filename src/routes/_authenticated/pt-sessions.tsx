import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Check, Dumbbell, MoreHorizontal, Pencil, UserRoundX, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PtSessionDialog } from "@/components/scheduling/pt-session-dialog";
import { TrainerSchedule } from "@/components/scheduling/trainer-schedule";
import { SearchInput } from "@/components/common/search-input";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLive } from "@/hooks/use-live-query";
import { BOOKING_STATUS_META, formatDateISO, formatTime, todayISO } from "@/lib/format";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeBookings, updateBookingStatus } from "@/services/bookings.service";
import type { Booking, BookingStatus } from "@/types/models";
export const Route = createFileRoute("/_authenticated/pt-sessions")({
  head: () => ({
    meta: [
      { title: "PT Sessions — REBUILD FITNESS" },
      { name: "description", content: "Manage personal training sessions and outcomes." },
      { property: "og:title", content: "PT Sessions — REBUILD FITNESS" },
      { property: "og:description", content: "Manage personal training sessions and outcomes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
type Filter = "today" | "upcoming" | "completed" | "cancelled" | "no_show" | "schedule";
function Page() {
  const live = useLive<Booking[]>(subscribeBookings, [], []);
  const [filter, setFilter] = useState<Filter>("today");
  const [editing, setEditing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const today = todayISO();
  const rows = useMemo(
    () =>
      live.data.filter(
        (b) =>
          b.bookingType === "pt" &&
          (!search.trim() ||
            [b.clientNameSnapshot, b.trainerNameSnapshot].some((v) =>
              v.toLowerCase().includes(search.trim().toLowerCase()),
            )) &&
          (filter === "today"
            ? b.date === today && b.status === "scheduled"
            : filter === "upcoming"
              ? b.date >= today && b.status === "scheduled"
              : b.status === filter),
      ),
    [live.data, filter, today, search],
  );
  const status = async (b: Booking, s: BookingStatus) => {
    try {
      await updateBookingStatus(b.id, s);
      toast.success(`Session marked ${BOOKING_STATUS_META[s].label.toLowerCase()}`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="PT Sessions"
        description="Personal training schedules and session outcomes."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "PT Sessions" }]}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Book PT session
          </Button>
        }
      />
      <SearchInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search client or trainer…"
        label="Search PT sessions"
      />
      <div className="no-scrollbar overflow-x-auto">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="w-max">
            <TabsTrigger value="schedule">Trainer schedule</TabsTrigger>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            <TabsTrigger value="no_show">No-show</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {filter === "schedule" ? (
        <TrainerSchedule bookings={live.data} />
      ) : live.loading ? (
        <LoadingRows rows={5} />
      ) : live.error ? (
        <ErrorState error={live.error} title="Couldn't load PT sessions" />
      ) : !rows.length ? (
        <EmptyState
          icon={Dumbbell}
          title="No PT sessions"
          description="Sessions matching this filter will appear here."
        />
      ) : (
        <>
          <div className="surface-card hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>PT Package</TableHead>
                  <TableHead>Trainer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-semibold">{b.clientNameSnapshot}</TableCell>
                    <TableCell>{b.ptPackageNameSnapshot || "—"}</TableCell>
                    <TableCell>
                      {b.trainerNameSnapshot}
                      {b.trainerOverride ? (
                        <span className="text-meta block">
                          assigned {b.assignedTrainerNameSnapshot}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatDateISO(b.date)}</TableCell>
                    <TableCell>
                      {formatTime(b.startTime)} – {formatTime(b.endTime)}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={BOOKING_STATUS_META[b.status].tone}>
                        {BOOKING_STATUS_META[b.status].label}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <Actions b={b} edit={() => setEditing(b)} status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((b) => (
              <article key={b.id} className="surface-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{b.clientNameSnapshot}</h2>
                    <p className="text-meta">
                      {b.ptPackageNameSnapshot || "PT"} · Trainer {b.trainerNameSnapshot}
                    </p>
                  </div>
                  <Actions b={b} edit={() => setEditing(b)} status={status} />
                </div>
                <p className="mt-3 text-sm">
                  {formatDateISO(b.date)} · {formatTime(b.startTime)} – {formatTime(b.endTime)}
                </p>
                <StatusPill className="mt-3" tone={BOOKING_STATUS_META[b.status].tone}>
                  {BOOKING_STATUS_META[b.status].label}
                </StatusPill>
              </article>
            ))}
          </div>
        </>
      )}
      <PtSessionDialog
        open={!!editing || creating}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setCreating(false);
          }
        }}
        booking={editing}
      />
    </div>
  );
}
function Actions({
  b,
  edit,
  status,
}: {
  b: Booking;
  edit: () => void;
  status: (b: Booking, s: BookingStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${b.clientNameSnapshot}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={edit}>
          <Pencil /> Edit
        </DropdownMenuItem>
        {b.status === "scheduled" ? (
          <>
            <DropdownMenuItem onSelect={() => void status(b, "completed")}>
              <Check /> Mark Completed
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void status(b, "cancelled")}>
              <XCircle /> Mark Cancelled
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void status(b, "no_show")}>
              <UserRoundX /> Mark No-show
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
