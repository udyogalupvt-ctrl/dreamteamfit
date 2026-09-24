import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnrollment } from "@/components/enrollment/enrollment-context";
import { useLive } from "@/hooks/use-live-query";
import { addDaysISO, formatDateISO, todayISO } from "@/lib/format";
import { createBooking, updateBooking } from "@/services/bookings.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribePtAssignments, subscribeTrainers } from "@/services/pt.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { Booking, BookingStatus, Client, PtAssignment, Trainer } from "@/types/models";

/** Picks the client's PT assignment that backs sessions: active first, then most recent. */
export function activePtFor(assignments: PtAssignment[], clientId: string, date = todayISO()) {
  const mine = assignments.filter((a) => a.clientId === clientId);
  return (
    mine.find((a) => a.status === "active" && a.startDate <= date && a.endDate >= date) ??
    mine.find((a) => a.status === "active" && a.endDate >= todayISO()) ??
    mine[0] ??
    null
  );
}

export function PtSessionDialog({
  open,
  onOpenChange,
  booking,
  initialClient,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  booking?: Booking | null;
  initialClient?: Client | null;
}) {
  const clients = useLive<Client[]>(open ? subscribeClients : null, [], [open]);
  const assignments = useLive<PtAssignment[]>(open ? subscribePtAssignments : null, [], [open]);
  const trainers = useLive<Trainer[]>(open ? subscribeTrainers : null, [], [open]);
  const { openEnrollment } = useEnrollment();
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:00");
  const [override, setOverride] = useState(false);
  const [sessionTrainer, setSessionTrainer] = useState("");
  const [dateOverride, setDateOverride] = useState(false);
  const [status, setStatus] = useState<BookingStatus>("scheduled");
  const [notes, setNotes] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId(booking?.clientId ?? initialClient?.id ?? "");
    setDate(booking?.date ?? todayISO());
    setStart(booking?.startTime ?? "18:00");
    setEnd(booking?.endTime ?? "19:00");
    setOverride(booking?.trainerOverride ?? false);
    setSessionTrainer(booking?.trainerId ?? "");
    setDateOverride(booking?.dateOverride ?? false);
    setStatus(booking?.status ?? "scheduled");
    setNotes(booking?.notes ?? "");
    setRepeat(false);
    setError("");
  }, [open, booking, initialClient]);

  const client =
    clients.data.find((c) => c.id === clientId) ??
    (initialClient?.id === clientId ? initialClient : null);
  const pt = useMemo(() => {
    if (booking?.ptAssignmentId)
      return assignments.data.find((a) => a.id === booking.ptAssignmentId) ?? null;
    return clientId ? activePtFor(assignments.data, clientId, date) : null;
  }, [assignments.data, clientId, date, booking]);
  const ptProblem = !clientId
    ? ""
    : !pt
      ? "No active PT package for this client."
      : pt.status === "cancelled"
        ? "This PT package was cancelled."
        : pt.status !== "active"
          ? pt.status === "pending"
            ? "PT package is waiting for fingerprint activation."
            : "No active PT package for this client."
          : pt.endDate < todayISO() && !booking
            ? "PT package has expired."
            : "";
  const outside = !!pt && (date < pt.startDate || date > pt.endDate);
  const actualTrainer = override
    ? (trainers.data.find((t) => t.id === sessionTrainer) ?? null)
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!client) return setError("Select a client.");
    if (!pt || (ptProblem && status === "scheduled"))
      return setError(ptProblem || "No active PT package for this client.");
    if (outside && !dateOverride && status === "scheduled")
      return setError("Selected date is outside the active PT package period.");
    if (override && !actualTrainer) return setError("Choose the session trainer.");
    const trainerId = actualTrainer?.id ?? pt.trainerId;
    const trainerName = actualTrainer?.name ?? pt.trainerNameSnapshot;
    const value = {
      clientId: client.id,
      clientNameSnapshot: booking?.clientNameSnapshot || client.fullName,
      bookingType: "pt" as const,
      trainerId,
      trainerNameSnapshot: trainerName,
      groupClassId: "",
      date,
      startTime: start,
      endTime: end,
      status,
      notes,
      ptAssignmentId: pt.id,
      ptPackageId: pt.ptPackageId,
      ptPackageNameSnapshot: booking?.ptPackageNameSnapshot || pt.ptPackageNameSnapshot,
      assignedTrainerId: pt.trainerId,
      assignedTrainerNameSnapshot: pt.trainerNameSnapshot,
      trainerOverride: !!actualTrainer && actualTrainer.id !== pt.trainerId,
      dateOverride: outside && dateOverride,
    };
    setSaving(true);
    try {
      if (booking) await updateBooking(booking.id, value);
      else if (repeat && pt) {
        // Same time every day (Mon–Sat) until the PT package ends; busy days are skipped.
        let booked = 0;
        const skipped: string[] = [];
        for (let d = date; d <= pt.endDate; d = addDaysISO(d, 1)) {
          if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) continue;
          try {
            await createBooking({ ...value, date: d, dateOverride: false });
            booked += 1;
          } catch {
            skipped.push(formatDateISO(d));
          }
        }
        toast.success(`${booked} PT sessions booked`, {
          description: skipped.length
            ? `Skipped (busy): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}`
            : "Every day except Sundays",
        });
      } else await createBooking(value);
      if (booking || !repeat) toast.success(booking ? "PT session updated" : "PT session booked");
      onOpenChange(false);
    } catch (err) {
      const m = err instanceof Error && !("code" in err) ? err.message : firestoreErrorMessage(err);
      setError(m.includes("[") ? m : m);
      toast.error(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={booking ? "Edit PT session" : "Book PT session"}
      description="Linked to the client's PT package. Booking a session never charges the client."
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="pt-session-form"
            disabled={saving || (!!ptProblem && status === "scheduled")}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            {booking ? "Save changes" : repeat ? "Book all sessions" : "Book session"}
          </Button>
        </>
      }
    >
      <form id="pt-session-form" onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Client" htmlFor="pts-client" required>
          <Select
            value={clientId}
            onValueChange={setClientId}
            disabled={!!initialClient || !!booking}
          >
            <SelectTrigger id="pts-client" className="w-full">
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {(initialClient ? [initialClient] : clients.data).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.fullName} · {c.clientCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {clientId && pt ? (
          <div
            className="grid gap-2 rounded-xl border border-border bg-muted/40 p-4 text-sm sm:grid-cols-3"
            data-testid="pt-link"
          >
            <div>
              <p className="text-meta">PT package</p>
              <p className="font-semibold">{pt.ptPackageNameSnapshot}</p>
            </div>
            <div>
              <p className="text-meta">Assigned trainer</p>
              <p className="font-semibold">{pt.trainerNameSnapshot}</p>
            </div>
            <div>
              <p className="text-meta">Active period</p>
              <p className="font-semibold">
                {formatDateISO(pt.startDate)} – {formatDateISO(pt.endDate)}
              </p>
            </div>
          </div>
        ) : null}
        {ptProblem && status === "scheduled" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
          >
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4" /> {ptProblem}
            </span>
            {client ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  openEnrollment({ existingClient: client });
                }}
              >
                <Plus /> Add PT Package
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" htmlFor="pts-date" required>
            <Input
              id="pts-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Start time" htmlFor="pts-start" required>
            <Input
              id="pts-start"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="End time" htmlFor="pts-end" required>
            <Input id="pts-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {outside && pt ? (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-semibold">Selected date is outside the active PT package period.</p>
            <label className="mt-2 flex items-center gap-2">
              <Checkbox
                checked={dateOverride}
                onCheckedChange={(v) => setDateOverride(v === true)}
              />{" "}
              Admin override: book anyway
            </label>
          </div>
        ) : null}
        {pt ? (
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} /> Use a
              different trainer for this session only
            </label>
            {override ? (
              <Field label="Session trainer" htmlFor="pts-trainer" required>
                <Select value={sessionTrainer} onValueChange={setSessionTrainer}>
                  <SelectTrigger id="pts-trainer" className="w-full">
                    <SelectValue placeholder="Choose trainer" />
                  </SelectTrigger>
                  <SelectContent>
                    {trainers.data
                      .filter((t) => t.status === "active")
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-meta mt-1">
                  Assigned trainer stays {pt.trainerNameSnapshot}; the PT package is not changed.
                </p>
              </Field>
            ) : null}
          </div>
        ) : null}
        {booking ? (
          <Field label="Status" htmlFor="pts-status">
            <Select value={status} onValueChange={(v) => setStatus(v as BookingStatus)}>
              <SelectTrigger id="pts-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="no_show">No-show</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {!booking && pt && pt.endDate > date ? (
          <label className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-medium">
            <Checkbox checked={repeat} onCheckedChange={(v) => setRepeat(v === true)} /> Same time
            every day (Mon–Sat) until the PT ends on {formatDateISO(pt.endDate)}
          </label>
        ) : null}
        <Field label="Notes" htmlFor="pts-notes">
          <Textarea
            id="pts-notes"
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </FormDialog>
  );
}
