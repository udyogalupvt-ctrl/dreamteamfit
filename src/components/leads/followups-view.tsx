import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { addDays, endOfWeek, format, startOfWeek } from "date-fns";
import {
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { RecordFollowUpDialog } from "@/components/leads/record-followup-dialog";
import { FollowUpDialog } from "@/components/followups/followup-dialog";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, formatTime, normalizePhone, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { subscribeClients } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { rescheduleFollowUp, subscribeFollowUps } from "@/services/followups.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import type { Client, FollowUp, Inquiry } from "@/types/models";

type Filter = "due" | "tomorrow" | "week" | "later" | "completed";
const FILTERS: [Filter, string][] = [
  ["due", "Due now"],
  ["tomorrow", "Tomorrow"],
  ["week", "This week"],
  ["later", "All upcoming"],
  ["completed", "Done"],
];

export function FollowUpsView() {
  const live = useLive<FollowUp[]>(subscribeFollowUps, [], []);
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const { openEnrollment } = useEnrollment();
  const [filter, setFilter] = useState<Filter>("due");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FollowUp | null>(null);
  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState<FollowUp | null>(null);
  const [moving, setMoving] = useState<FollowUp | null>(null);

  const today = todayISO();
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const matches = (x: FollowUp, f: Filter) => {
    if (f === "completed") return x.status === "completed";
    if (x.status !== "pending") return false;
    if (f === "due") return x.followUpDate <= today;
    if (f === "tomorrow") return x.followUpDate === tomorrow;
    if (f === "week") return x.followUpDate >= weekStart && x.followUpDate <= weekEnd;
    return x.followUpDate > today;
  };
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim(),
      phone = normalizePhone(search);
    const rows = live.data.filter((x) => {
      if (
        q &&
        !x.clientNameSnapshot.toLowerCase().includes(q) &&
        !(phone.length >= 3 && normalizePhone(x.phoneSnapshot).includes(phone))
      )
        return false;
      return matches(x, filter);
    });
    return filter === "completed" ? rows.reverse().slice(0, 100) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data, filter, search, today, tomorrow, weekStart, weekEnd]);

  const convert = (x: FollowUp) => {
    const lead = inquiries.data.find((i) => i.id === x.inquiryId);
    openEnrollment({
      inquiryId: x.inquiryId,
      prefill: {
        fullName: x.clientNameSnapshot,
        phone: x.phoneSnapshot,
        email: lead?.email ?? "",
        source: lead?.source ?? "walk_in",
      },
    });
  };

  const actions = (x: FollowUp) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`More for ${x.clientNameSnapshot}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setMoving(x)}>
          <RotateCcw aria-hidden /> Move to another day
        </DropdownMenuItem>
        {!x.inquiryId ? (
          <DropdownMenuItem onSelect={() => setEditing(x)}>
            <Pencil aria-hidden /> Edit
          </DropdownMenuItem>
        ) : null}
        {x.clientId ? (
          <DropdownMenuItem asChild>
            <Link to="/clients/$clientId" params={{ clientId: x.clientId }}>
              <UserRound aria-hidden /> Open member
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const count = (f: Filter) => live.data.filter((x) => matches(x, f)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-1 sm:flex-wrap sm:px-0"
          role="tablist"
          aria-label="Follow-up views"
        >
          {FILTERS.map(([v, l]) => (
            <button
              key={v}
              role="tab"
              aria-selected={filter === v}
              onClick={() => setFilter(v)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                filter === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {l}{" "}
              {v !== "completed" ? (
                <span className="tabular-nums opacity-70">{count(v)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> Schedule a member call
        </Button>
      </div>
      <SearchInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search name or phone…"
        label="Search follow-ups"
        containerClassName="sm:max-w-md"
      />

      {live.loading ? (
        <LoadingRows rows={5} />
      ) : live.error ? (
        <ErrorState error={live.error} title="Couldn't load follow-ups" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={filter === "due" ? "No calls due. Nice work!" : "Nothing here"}
          description={
            filter === "due"
              ? "New inquiries get a call scheduled automatically."
              : "Try another tab."
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {filtered.map((x) => {
            const overdue = x.status === "pending" && x.followUpDate < today;
            return (
              <li key={x.id} className="surface-card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{x.clientNameSnapshot}</p>
                    <p className="text-meta tabular-nums">
                      {x.phoneSnapshot} · {x.inquiryId ? "Lead" : "Member"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {x.status === "completed" ? (
                      <StatusPill tone="success">{x.outcome || "Done"}</StatusPill>
                    ) : (
                      <StatusPill
                        tone={overdue ? "danger" : x.followUpDate === today ? "warning" : "info"}
                      >
                        {overdue
                          ? `Overdue · ${formatDateISO(x.followUpDate)}`
                          : x.followUpDate === today
                            ? `Today ${formatTime(x.followUpTime)}`
                            : `${formatDateISO(x.followUpDate)} ${formatTime(x.followUpTime)}`}
                      </StatusPill>
                    )}
                    {x.status === "pending" ? actions(x) : null}
                  </div>
                </div>
                <p className="text-sm">
                  <span className="font-semibold">{x.nextAction || x.reason}</span>
                  {x.notes ? <span className="text-muted-foreground"> — “{x.notes}”</span> : null}
                </p>
                {x.status === "pending" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-11" asChild>
                      <a href={`tel:${x.phoneSnapshot}`}>
                        <Phone aria-hidden /> Call
                      </a>
                    </Button>
                    <Button className="h-11" onClick={() => setRecording(x)}>
                      Record call
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <FollowUpDialog
        open={creating || Boolean(editing)}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
        clients={clients.data}
        item={editing}
      />
      <RecordFollowUpDialog
        target={
          recording
            ? {
                inquiryId: recording.inquiryId,
                clientId: recording.clientId,
                name: recording.clientNameSnapshot,
                phone: recording.phoneSnapshot,
                currentFollowUpId: recording.id,
              }
            : null
        }
        onClose={() => setRecording(null)}
        onConvert={() => recording && convert(recording)}
      />
      <MoveDialog item={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function MoveDialog({ item, onClose }: { item: FollowUp | null; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (item && item.id !== lastId) {
    setLastId(item.id);
    setDate(item.followUpDate);
    setTime(item.followUpTime);
  }
  const save = async () => {
    if (!item || !date) return;
    setSaving(true);
    try {
      await rescheduleFollowUp(item, date, time);
      toast.success("Call moved", { description: formatDateISO(date) });
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o) {
          setLastId(null);
          onClose();
        }
      }}
      title={`Move call · ${item?.clientNameSnapshot ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !date} onClick={() => void save()}>
            Move call
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="mv-date">
          <Input
            id="mv-date"
            type="date"
            min={todayISO()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Time" htmlFor="mv-time">
          <Input id="mv-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}
