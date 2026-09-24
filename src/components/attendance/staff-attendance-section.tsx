import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Plus, UserCog } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { LoadingRows } from "@/components/common/loading-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO, todayISO } from "@/lib/format";
import {
  DAY_MARK_LABELS,
  DAY_MARKS,
  DAY_STATUS_META,
  staffMonth,
  type DayMark,
  type DayMarkDoc,
} from "@/lib/staff-salary";
import { cn } from "@/lib/utils";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  markStaffAttendance,
  setDayMark,
  subscribeDayMarks,
  subscribePaidLeaves,
  subscribeStaff,
  subscribeStaffAttendance,
} from "@/services/staff.service";
import type { Staff, StaffAttendanceEvent } from "@/types/models";

/**
 * Staff attendance: a thumb punch makes the day Present. Admin or receptionist can set any day
 * to Present, Half day, Absent or Paid leave. Sundays are holidays.
 */
export function StaffAttendanceSection() {
  const { user } = useAuth();
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const events = useLive<StaffAttendanceEvent[]>(subscribeStaffAttendance, [], []);
  const marks = useLive<DayMarkDoc[]>(subscribeDayMarks, [], []);
  const leaves = useLive<Record<string, number>>(subscribePaidLeaves, {}, []);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [marking, setMarking] = useState(false);
  const today = todayISO();
  const active = staff.data.filter((s) => s.active);

  const rows = useMemo(
    () =>
      active.map((s) => {
        const todays = events.data
          .filter((e) => e.staffId === s.id && e.attendanceDate === today)
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        return {
          staff: s,
          firstIn: todays[0]?.timestamp ?? null,
          lastOut: todays.length > 1 ? todays[todays.length - 1]!.timestamp : null,
          // Salary is not needed here: 0 keeps this view free of pay details.
          month: staffMonth(
            s.id,
            month,
            0,
            leaves.data[`${s.id}_${month}`] ?? 0,
            events.data,
            marks.data,
            today,
            s.joiningDate,
          ),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staff.data, events.data, marks.data, leaves.data, month, today],
  );

  const setMark = async (s: Staff, date: string, status: DayMark | "auto") => {
    try {
      await setDayMark(s, date, status, user?.displayName || user?.email || "Staff");
      toast.success(`${s.name} · ${formatDateISO(date)}: ${DAY_MARK_LABELS[status]}`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };

  if (staff.loading || events.loading) return <LoadingRows rows={4} />;
  if (staff.error || events.error)
    return (
      <ErrorState error={staff.error ?? events.error!} title="Couldn't load staff attendance" />
    );
  if (!active.length)
    return (
      <EmptyState
        icon={UserCog}
        title="No staff yet"
        description="Add staff on the Staff page and register their thumb on the fingerprint device."
      />
    );

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-section-title">Staff attendance</h2>
          <p className="text-meta">
            Thumb punch = present. Tap a day to change it. Sundays (S) are holidays.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value || today.slice(0, 7))}
            className="w-auto"
          />
          <Button variant="outline" onClick={() => setMarking(true)}>
            <Plus aria-hidden /> Punch by hand
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.staff.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{r.staff.name}</p>
                <p className="text-meta">
                  {r.staff.role || "Staff"}
                  {r.staff.firstThumbRegistered ? "" : " · thumb not registered"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {r.firstIn ? (
                  <StatusPill tone="success">
                    Today in {format(r.firstIn, "hh:mm a")}
                    {r.lastOut ? ` · last ${format(r.lastOut, "hh:mm a")}` : ""}
                  </StatusPill>
                ) : null}
                <StatusPill tone="success">{r.month.present} present</StatusPill>
                {r.month.half ? <StatusPill tone="warning">{r.month.half} half</StatusPill> : null}
                <StatusPill tone={r.month.absent ? "danger" : "info"}>
                  {r.month.absent} absent
                </StatusPill>
                {r.month.leave ? (
                  <StatusPill tone="info">{r.month.leave} paid leave</StatusPill>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 sm:grid-cols-[repeat(16,minmax(0,1fr))] lg:grid-cols-[repeat(31,minmax(0,1fr))]">
              {r.month.days.map((d) => (
                <DropdownMenu key={d.date}>
                  <DropdownMenuTrigger
                    asChild
                    disabled={d.status === "upcoming" || d.status === "notJoined"}
                  >
                    <button
                      type="button"
                      aria-label={`${r.staff.name} ${formatDateISO(d.date)}: ${DAY_STATUS_META[d.status].label}${d.marked ? " (set by hand)" : ""}`}
                      className={cn(
                        "flex h-10 flex-col items-center justify-center rounded-md border border-border text-[11px] leading-tight",
                        DAY_STATUS_META[d.status].className,
                        d.marked && "ring-1 ring-foreground/40",
                        d.date === today && "border-primary border-2",
                      )}
                    >
                      <span className="opacity-70">{Number(d.date.slice(8))}</span>
                      <b>{DAY_STATUS_META[d.status].short}</b>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>
                      {r.staff.name} · {formatDateISO(d.date)}
                    </DropdownMenuLabel>
                    {DAY_MARKS.map((m) => (
                      <DropdownMenuItem key={m} onSelect={() => void setMark(r.staff, d.date, m)}>
                        {DAY_MARK_LABELS[m]}
                      </DropdownMenuItem>
                    ))}
                    {d.marked ? (
                      <DropdownMenuItem onSelect={() => void setMark(r.staff, d.date, "auto")}>
                        {DAY_MARK_LABELS.auto}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-meta border-t border-border p-4">
        P present · ½ half day · A absent · L paid leave · S Sunday. A ring means the day was set by
        hand. Salary and paid leaves are in Income &amp; Expenses → Staff pay.
      </p>
      <PunchDialog open={marking} onClose={() => setMarking(false)} staff={active} />
    </section>
  );
}

function PunchDialog({
  open,
  onClose,
  staff,
}: {
  open: boolean;
  onClose: () => void;
  staff: Staff[];
}) {
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(format(new Date(), "HH:mm"));
  const [kind, setKind] = useState<"check_in" | "check_out">("check_in");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const s = staff.find((x) => x.id === staffId);
    if (!s) return;
    setSaving(true);
    try {
      await markStaffAttendance(s, date, time, kind);
      toast.success(`${s.name}: ${kind === "check_in" ? "in" : "out"} at ${time}`);
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Punch by hand"
      description="For a day the device was off, or someone without a thumb yet."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !staffId} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Staff" htmlFor="sa-staff" className="sm:col-span-2">
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger id="sa-staff" className="w-full">
              <SelectValue placeholder="Select staff" />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date" htmlFor="sa-date">
          <Input
            id="sa-date"
            type="date"
            max={todayISO()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Time" htmlFor="sa-time">
          <Input id="sa-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="In or out" htmlFor="sa-kind" className="sm:col-span-2">
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger id="sa-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="check_in">Came in</SelectItem>
              <SelectItem value="check_out">Went out</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </FormDialog>
  );
}
