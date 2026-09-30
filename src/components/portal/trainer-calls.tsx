import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Phone, PhoneCall, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CALL_OUTCOME_OPTIONS, type CallOutcome } from "@/constants/call-outcomes";
import type {
  TrainerCallInput,
  TrainerCallLead,
  TrainerCallMember,
  TrainerCallsData,
} from "@/constants/portal";
import { INQUIRY_STATUS_META, addDaysISO } from "@/lib/format";
import { portalCall } from "@/lib/portal-firebase";
import { cn } from "@/lib/utils";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import type { InquiryStatus } from "@/types/models";
import { day } from "./portal-shell";

type Target = { kind: "lead"; row: TrainerCallLead } | { kind: "member"; row: TrainerCallMember };

/** "Today" / "Overdue · 2 Sep" / "5 Oct" for a next-call date. */
function NextCall({ date, today }: { date: string; today: string }) {
  if (!date) return <span className="text-meta">No call planned</span>;
  const late = date < today;
  return (
    <span className={cn("text-meta font-semibold", late && "text-destructive")}>
      {date === today ? "Call today" : late ? `Overdue · ${day(date)}` : `Call on ${day(date)}`}
    </span>
  );
}

function ContactButtons({ phone, onLog }: { phone: string; onLog: () => void }) {
  const wa = normalizeWhatsAppPhone(phone);
  return (
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={`tel:${phone}`} aria-label={`Call ${phone}`}>
          <Phone aria-hidden /> Call
        </a>
      </Button>
      {wa.ok ? (
        <Button asChild size="sm" variant="outline">
          <a
            href={`https://wa.me/${wa.value}`}
            target="_blank"
            rel="noreferrer"
            aria-label="WhatsApp"
          >
            <MessageCircle aria-hidden />
          </a>
        </Button>
      ) : null}
      <Button size="sm" onClick={onLog}>
        <PhoneCall aria-hidden /> Log call
      </Button>
    </div>
  );
}

/**
 * Trainer app → Calls: the leads this trainer counsels (to convert) and the members they
 * counselled whose package ends soon or ended (to renew). Calls are saved like the front desk's.
 */
export function TrainerCalls() {
  const [data, setData] = useState<TrainerCallsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"leads" | "members">("leads");
  const [target, setTarget] = useState<Target | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await portalCall<TrainerCallsData>("/api/portal/trainer-calls"));
    } catch (e) {
      setError((e as Error).message || "Couldn't load your calls.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data)
    return loading ? (
      <div className="grid min-h-[40dvh] place-items-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    ) : (
      <section className="surface-card space-y-3 p-6 text-center">
        <p className="font-semibold">{error || "Couldn't load your calls."}</p>
        <Button onClick={() => load()}>
          <RefreshCw aria-hidden /> Try again
        </Button>
      </section>
    );
  if (!data.linked)
    return (
      <section className="surface-card space-y-2 p-6 text-center">
        <PhoneCall className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h2 className="font-bold">Calls are not set up for you yet</h2>
        <p className="text-sm text-muted-foreground">
          Ask the gym to link your counsellor profile: Packages → Trainers → your name → Counsellor
          profile. Leads and members you counsel then show here.
        </p>
      </section>
    );

  const due = (d: string) => !!d && d <= data.today;
  const leadsDue = data.leads.filter((l) => due(l.nextCallDate)).length;
  const membersDue = data.members.filter((m) => due(m.nextCallDate) || !m.nextCallDate).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Calls">
        {(
          [
            ["leads", `Leads (${data.leads.length})`, leadsDue],
            ["members", `Renewals (${data.members.length})`, membersDue],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "surface-card flex cursor-pointer flex-col items-start p-3 text-left",
              tab === id && "border-primary bg-primary/10",
            )}
          >
            <span className="font-bold">{label}</span>
            <span className="text-meta">{n ? `${n} to call now` : "Nothing due"}</span>
          </button>
        ))}
      </div>
      <p className="text-meta">Counsellor profile: {data.counsellorName}</p>

      {tab === "leads" ? (
        !data.leads.length ? (
          <p className="surface-card p-6 text-center text-sm text-muted-foreground">
            No open leads with you as counsellor.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.leads.map((l) => {
              const meta = INQUIRY_STATUS_META[l.status as InquiryStatus];
              return (
                <li key={l.inquiryId} className="surface-card space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{l.name}</p>
                      <p className="text-meta tabular-nums">{l.phone}</p>
                    </div>
                    <StatusPill tone={meta?.tone ?? "info"}>{meta?.label ?? l.status}</StatusPill>
                  </div>
                  <NextCall date={l.nextCallDate} today={data.today} />
                  {l.goal || l.notes ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {[l.goal, l.notes].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  <ContactButtons
                    phone={l.phone}
                    onLog={() => setTarget({ kind: "lead", row: l })}
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : !data.members.length ? (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">
          No members of yours with a package ending in the next 15 days or ended in the last 60.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.members.map((m) => (
            <li key={m.clientId} className="surface-card space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{m.name}</p>
                  <p className="text-meta tabular-nums">
                    {m.phone}
                    {m.memberId ? ` · ID ${m.memberId}` : ""}
                  </p>
                </div>
                <StatusPill tone={m.state === "ended" ? "danger" : "warning"}>
                  {m.state === "ended" ? `Ended ${day(m.endDate)}` : `Ends ${day(m.endDate)}`}
                </StatusPill>
              </div>
              <p className="text-meta">{m.packageName}</p>
              <NextCall date={m.nextCallDate} today={data.today} />
              <ContactButtons phone={m.phone} onLog={() => setTarget({ kind: "member", row: m })} />
            </li>
          ))}
        </ul>
      )}
      <LogCallDialog
        target={target}
        today={data.today}
        onClose={() => setTarget(null)}
        onSaved={() => void load()}
      />
    </>
  );
}

function LogCallDialog({
  target,
  today,
  onClose,
  onSaved,
}: {
  target: Target | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isLead = target?.kind === "lead";
  // "Joined today" is done at the front desk (the joining form and bill), so it isn't here.
  const options = CALL_OUTCOME_OPTIONS.filter(
    (o) => !o.convert && (o.for === "both" || o.for === (isLead ? "lead" : "member")),
  );
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [date, setDate] = useState("");
  const [said, setSaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setOutcome(null);
    setDate("");
    setSaid("");
    setError("");
  }, [target]);

  const save = async () => {
    if (!target) return;
    if (!outcome) return setError("Tap what they said.");
    if (outcome.date && !date) return setError("Pick a date.");
    setSaving(true);
    try {
      const body: TrainerCallInput = {
        inquiryId: target.kind === "lead" ? target.row.inquiryId : null,
        clientId: target.kind === "member" ? target.row.clientId : "",
        followUpId: target.kind === "member" ? target.row.followUpId : "",
        outcomeId: outcome.id,
        said,
        date: outcome.date ? date : "",
      };
      await portalCall("/api/portal/trainer-call", body);
      toast.success("Call saved", {
        description: outcome.date ? `Next: ${day(date)}` : outcome.label,
      });
      onClose();
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

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
      title={`Log call · ${target?.row.name ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !outcome} onClick={() => save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save call
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="text-label mb-2">What did they say?</legend>
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={outcome?.id === o.id}
                onClick={() => {
                  setOutcome(o);
                  setError("");
                  setDate(o.date ? addDaysISO(today, o.defaultDays) : "");
                }}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 text-left text-sm font-semibold",
                  outcome?.id === o.id
                    ? o.tone === "bad"
                      ? "border-destructive bg-destructive/10"
                      : "border-primary bg-primary/10"
                    : "border-border hover:bg-accent",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
        {outcome?.date ? (
          <label className="grid gap-1.5">
            <span className="text-label">{dateLabel}</span>
            <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        ) : null}
        <label className="grid gap-1.5">
          <span className="text-label">Notes (optional)</span>
          <Textarea
            value={said}
            maxLength={1000}
            placeholder="What they said, timings, price asked…"
            onChange={(e) => setSaid(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
