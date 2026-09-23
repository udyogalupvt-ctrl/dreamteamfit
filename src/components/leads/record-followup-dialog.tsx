import { useEffect, useState } from "react";
import { Loader2, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { addDaysISO, formatDate, formatDateISO, todayISO } from "@/lib/format";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { cn } from "@/lib/utils";
import { recordLeadFollowUp, subscribeLeadLogs } from "@/services/lead-logs.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { FollowUpPriority, InquiryStatus, LeadLog } from "@/types/models";

export interface FollowUpTarget {
  inquiryId: string | null;
  clientId: string;
  name: string;
  phone: string;
  currentFollowUpId?: string | null;
}

/** What the person said on the call, and what that means for the next step. */
interface Outcome {
  id: string;
  label: string;
  for: "lead" | "member" | "both";
  status: InquiryStatus | null;
  /** Which date the staff must fill; the next call is scheduled from it. */
  date: "join" | "visit" | "call" | null;
  defaultDays: number;
  nextAction: string;
  priority: FollowUpPriority;
  tone: "good" | "neutral" | "bad";
  convert?: boolean;
}

const OUTCOMES: Outcome[] = [
  {
    id: "join",
    label: "Will join",
    for: "lead",
    status: "expected_to_join",
    date: "join",
    defaultDays: 2,
    nextAction: "Confirm joining",
    priority: "high",
    tone: "good",
  },
  {
    id: "visit",
    label: "Will visit the gym",
    for: "lead",
    status: "interested",
    date: "visit",
    defaultDays: 1,
    nextAction: "Expecting gym visit",
    priority: "high",
    tone: "good",
  },
  {
    id: "renew",
    label: "Will renew / pay",
    for: "member",
    status: null,
    date: "call",
    defaultDays: 2,
    nextAction: "Confirm renewal",
    priority: "high",
    tone: "good",
  },
  {
    id: "call_later",
    label: "Call me later",
    for: "both",
    status: "follow_up",
    date: "call",
    defaultDays: 2,
    nextAction: "Call again",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "thinking",
    label: "Thinking / needs time",
    for: "both",
    status: "interested",
    date: "call",
    defaultDays: 3,
    nextAction: "Call again",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "price",
    label: "Price concern",
    for: "both",
    status: "interested",
    date: "call",
    defaultDays: 3,
    nextAction: "Offer / discuss price",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "no_answer",
    label: "Didn't pick up",
    for: "both",
    status: "contacted",
    date: "call",
    defaultDays: 1,
    nextAction: "Try calling again",
    priority: "medium",
    tone: "neutral",
  },
  {
    id: "joined",
    label: "Joined today",
    for: "lead",
    status: null,
    date: null,
    defaultDays: 0,
    nextAction: "",
    priority: "low",
    tone: "good",
    convert: true,
  },
  {
    id: "not_interested",
    label: "Not interested",
    for: "both",
    status: "lost",
    date: null,
    defaultDays: 0,
    nextAction: "",
    priority: "low",
    tone: "bad",
  },
  {
    id: "wrong",
    label: "Wrong number",
    for: "both",
    status: "lost",
    date: null,
    defaultDays: 0,
    nextAction: "",
    priority: "low",
    tone: "bad",
  },
];

const QUICK_DAYS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

export function RecordFollowUpDialog({
  target,
  onClose,
  onConvert,
}: {
  target: FollowUpTarget | null;
  onClose: () => void;
  /** Opens the joining popup for this lead ("Joined today"). */
  onConvert?: () => void;
}) {
  const { user } = useAuth();
  const isLead = Boolean(target?.inquiryId);
  const options = OUTCOMES.filter(
    (o) => o.for === "both" || o.for === (isLead ? "lead" : "member"),
  );
  const [outcomeId, setOutcomeId] = useState("");
  const [date, setDate] = useState("");
  const [callDate, setCallDate] = useState("");
  const [callTime, setCallTime] = useState("10:00");
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setOutcomeId("");
    setDate("");
    setCallDate("");
    setCallTime("10:00");
    setSaid("");
    setError("");
  }, [target]);

  const outcome = options.find((o) => o.id === outcomeId) ?? null;
  const pick = (o: Outcome) => {
    setOutcomeId(o.id);
    setError("");
    const d = o.date ? addDaysISO(todayISO(), o.defaultDays) : "";
    setDate(d);
    // For join/visit, call on that day to confirm; for "call later" the date IS the call date.
    setCallDate(d);
  };

  const save = async () => {
    if (!target) return;
    if (!outcome) return setError("Tap what they said.");
    if (outcome.convert) {
      onClose();
      onConvert?.();
      return;
    }
    if (outcome.date && !date) return setError("Pick a date.");
    const nextCallDate = outcome.date ? (outcome.date === "call" ? date : callDate || date) : "";
    setSaving(true);
    try {
      await recordLeadFollowUp(
        {
          inquiryId: target.inquiryId,
          clientId: target.clientId,
          customerSaid: said.trim(),
          response: outcome.label,
          nextAction: outcome.nextAction,
          nextCallDate,
          nextCallTime: nextCallDate ? callTime : "",
          expectedJoinDate: outcome.date === "join" ? date : "",
          expectedVisitDate: outcome.date === "visit" ? date : "",
          priority: outcome.priority,
          notes: "",
          createdBy: user?.displayName || user?.email || "Staff",
          status: isLead ? outcome.status : null,
        },
        target,
      );
      toast.success("Call saved", {
        description: nextCallDate ? `Next call ${formatDateISO(nextCallDate)}` : outcome.label,
      });
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const wa = target ? normalizeWhatsAppPhone(target.phone) : null;
  const dateLabel =
    outcome?.date === "join"
      ? "Joining on"
      : outcome?.date === "visit"
        ? "Visiting on"
        : "Call again on";

  return (
    <FormDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={`Record call · ${target?.name ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="lg" disabled={saving || !outcome} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {outcome?.convert ? "Open joining form" : "Save call"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {target ? (
          <div className="flex gap-2">
            <Button variant="outline" asChild className="flex-1">
              <a href={`tel:${target.phone}`}>
                <Phone aria-hidden /> Call {target.phone}
              </a>
            </Button>
            {wa?.ok ? (
              <Button variant="outline" asChild>
                <a
                  href={`https://wa.me/${wa.value}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open WhatsApp chat"
                >
                  <MessageCircle aria-hidden />
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}

        <fieldset>
          <legend className="text-label mb-2">What did they say?</legend>
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={outcomeId === o.id}
                onClick={() => pick(o)}
                className={cn(
                  "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors",
                  outcomeId === o.id
                    ? o.tone === "bad"
                      ? "border-destructive bg-destructive/15"
                      : "border-primary bg-primary/15 ring-1 ring-primary"
                    : "border-border hover:bg-accent",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </fieldset>

        {outcome?.date ? (
          <div className="space-y-3 rounded-xl border border-border p-3">
            <Field label={dateLabel} htmlFor="r-date">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_DAYS.map((q) => {
                  const d = addDaysISO(todayISO(), q.days);
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => {
                        setDate(d);
                        setCallDate(d);
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                        date === d
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
              <Input
                id="r-date"
                type="date"
                min={todayISO()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setCallDate(e.target.value);
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {outcome.date !== "call" ? (
                <Field label="Call to confirm on" htmlFor="r-cd">
                  <Input
                    id="r-cd"
                    type="date"
                    min={todayISO()}
                    value={callDate}
                    onChange={(e) => setCallDate(e.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="Call at" htmlFor="r-ct">
                <Input
                  id="r-ct"
                  type="time"
                  value={callTime}
                  onChange={(e) => setCallTime(e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : outcome && !outcome.convert ? (
          <p className="text-meta">
            {isLead
              ? "This closes the lead. No more calls will be scheduled."
              : "No more calls will be scheduled."}
          </p>
        ) : null}

        <Field label="Notes (optional)" htmlFor="r-said">
          <Textarea
            id="r-said"
            rows={2}
            value={said}
            onChange={(e) => setSaid(e.target.value)}
            placeholder="e.g. Will join after salary on the 5th"
          />
        </Field>
      </div>
    </FormDialog>
  );
}

export function LeadTimeline({ field, id }: { field: "inquiryId" | "clientId"; id: string }) {
  const logs = useLive((ok, fail) => subscribeLeadLogs(field, id, ok, fail), [] as LeadLog[], [
    field,
    id,
  ]);
  if (logs.loading) return <p className="text-meta">Loading calls…</p>;
  if (!logs.data.length) return <p className="text-meta">No calls recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-4">
      {logs.data.map((l) => (
        <li key={l.id} className="relative">
          <span
            className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary"
            aria-hidden
          />
          <p className="text-sm font-bold">{l.response}</p>
          {l.customerSaid ? <p className="text-sm">“{l.customerSaid}”</p> : null}
          <p className="text-meta">
            {[
              l.expectedJoinDate && `Joining ${formatDateISO(l.expectedJoinDate)}`,
              l.expectedVisitDate && `Visiting ${formatDateISO(l.expectedVisitDate)}`,
              l.nextCallDate && `Next call ${formatDateISO(l.nextCallDate)} ${l.nextCallTime}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-meta">
            {formatDate(l.createdAt)} · {l.createdBy}
          </p>
        </li>
      ))}
    </ol>
  );
}
