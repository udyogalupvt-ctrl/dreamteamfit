import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2, Megaphone, Send } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { useMemberSegments } from "@/hooks/use-member-segments";
import {
  ANNOUNCEMENT_MAX,
  announcementText,
  buildRecipients,
  cleanMessage,
  splitNumbers,
} from "@/lib/announcement";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "@/lib/firestore";
import { formatDate } from "@/lib/format";
import { SEGMENT_META } from "@/lib/member-segments";
import { cn } from "@/lib/utils";
import {
  createAnnouncement,
  runAnnouncement,
  subscribeAnnouncements,
} from "@/services/announcements.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  isWhatsAppApiLive,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import {
  ANNOUNCEMENT_GROUPS,
  type Announcement,
  type AnnouncementGroup,
  type Client,
} from "@/types/models";

export const Route = createFileRoute("/_authenticated/announcements")({
  head: () => ({ meta: [{ title: "Announcements — REBUILD FITNESS" }] }),
  component: AnnouncementsPage,
});

const GROUP_HINT: Record<AnnouncementGroup, string> = {
  active: "Running plan and coming",
  inactive: "Paid, but not come for 7+ days",
  blacklist: "Plan ended, not renewed",
};
const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

type Running = { id: string; done: number; total: number };

/** One WhatsApp message to a group of members and/or typed numbers. Each number gets it once. */
function AnnouncementsPage() {
  const { user } = useAuth();
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const history = useLive<Announcement[]>(subscribeAnnouncements, [], []);
  const { segments, counts, loading, error } = useMemberSegments({
    absentDays: 7,
    expiringDays: 7,
    renewalWindowDays: 365,
  });
  const [groups, setGroups] = useState<AnnouncementGroup[]>([]);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [rate, setRate] = useState(0.79);

  // Same Marketing price as the WhatsApp usage page.
  useEffect(() => {
    void getDoc(doc(db, "settings", "whatsappCost"))
      .then((s) => {
        const m = Number(s.data()?.["marketing"]);
        if (m > 0) setRate(m);
      })
      .catch(() => undefined);
  }, []);
  // Closing the page mid-send stops it (the rest can be sent later), so warn first.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const live = isWhatsAppApiLive(wa.data);
  const gym = business.data.businessName || "our gym";
  const { recipients, leftOut, invalid } = useMemo(
    () => buildRecipients(segments, groups, typed, clients.data, wa.data.defaultCountryCode),
    [segments, groups, typed, clients.data, wa.data.defaultCountryCode],
  );
  const text = cleanMessage(message);
  const canSend = live && !!user && recipients.length > 0 && text.length > 0 && !running;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

  const toggle = (g: AnnouncementGroup) =>
    setGroups((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]));

  const run = async (a: Pick<Announcement, "id" | "message" | "recipients">) => {
    setRunning({ id: a.id, done: 0, total: a.recipients.length });
    try {
      const r = await runAnnouncement(a, (done, total) => setRunning({ id: a.id, done, total }));
      if (r.failed) toast.warning(`Sent to ${r.sent} of ${r.total}. ${r.failed} not sent.`);
      else toast.success(`Announcement sent to ${people(r.sent)}`);
    } catch (e) {
      toast.error("Announcement not sent", { description: firestoreErrorMessage(e) });
    } finally {
      setRunning(null);
    }
  };

  const send = async () => {
    setConfirming(false);
    if (!canSend || !user) return;
    setRunning({ id: "", done: 0, total: recipients.length });
    try {
      const id = await createAnnouncement(
        {
          message: text,
          groups,
          typedNumbers: splitNumbers(typed).length - invalid.length,
          recipients,
          skipped: leftOut.length,
        },
        { uid: user.uid, name: user.displayName || user.email || "Staff" },
      );
      setMessage("");
      setTyped("");
      setGroups([]);
      await run({ id, message: text, recipients });
    } catch (e) {
      setRunning(null);
      toast.error("Announcement not sent", { description: firestoreErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp announcements"
        description="Send one short message to a group of members or to any numbers. Each number gets it once."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Announcements" }]}
      />
      {error ? <ErrorState error={error} title="Couldn't load members" /> : null}
      {!wa.loading && !live ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          WhatsApp Cloud API is off, so announcements can't be sent.{" "}
          <Link to="/settings" className="font-semibold underline">
            Turn it on in Settings & WhatsApp
          </Link>
          .
        </p>
      ) : null}

      <section className="surface-card space-y-4 p-4 sm:p-5">
        <h2 className="text-section-title">1. Who gets it</h2>
        {loading ? (
          <LoadingRows rows={1} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {ANNOUNCEMENT_GROUPS.map((g) => {
              const on = groups.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(g)}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                    on ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                    aria-hidden
                  >
                    {on ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold">
                      {SEGMENT_META[g].label} · {counts[g]}
                    </span>
                    <span className="text-meta">{GROUP_HINT[g]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ann-numbers">Other phone numbers (optional)</Label>
          <Textarea
            id="ann-numbers"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={"9849834102, 9876543210\nOne per line or separated by commas"}
            rows={3}
          />
          {invalid.length ? (
            <p className="text-xs text-destructive">Not a valid number: {invalid.join(", ")}</p>
          ) : (
            <p className="text-meta">10-digit Indian numbers are fine; +91 is added for you.</p>
          )}
        </div>
      </section>

      <section className="surface-card space-y-4 p-4 sm:p-5">
        <h2 className="text-section-title">2. Message</h2>
        <div className="space-y-1.5">
          <Label htmlFor="ann-message">Your announcement</Label>
          <Textarea
            id="ann-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, ANNOUNCEMENT_MAX))}
            placeholder="e.g. The gym will be closed this Sunday for maintenance. We open again on Monday at 5 AM."
            rows={4}
          />
          <p className="text-meta">
            {text.length} / {ANNOUNCEMENT_MAX} · Keep it short. Line breaks become spaces (a
            WhatsApp rule).
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold">What they will see</p>
          <div className="max-w-md whitespace-pre-line rounded-2xl rounded-tl-sm bg-success/10 p-3 text-sm ring-1 ring-success/20">
            {announcementText(
              recipients[0]?.name || "Ravi",
              gym,
              text || "Your message will appear here.",
            )}
          </div>
        </div>
      </section>

      <section className="surface-card space-y-3 p-4 sm:p-5">
        <h2 className="text-section-title">3. Send</h2>
        <p className="text-sm">
          Goes to <strong>{people(recipients.length)}</strong>
          {recipients.length ? (
            <span className="text-muted-foreground">
              {" "}
              · Meta charges about {money(recipients.length * rate)} (Marketing, ~{money(rate)}{" "}
              each)
            </span>
          ) : null}
        </p>
        {leftOut.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {leftOut.length} left out (said no to WhatsApp or no valid number)
            </summary>
            <ul className="mt-2 space-y-1">
              {leftOut.map((x, i) => (
                <li key={`${x.phone}-${i}`} className="text-meta">
                  {x.name} · {x.phone || "no number"} · {x.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {running && !history.data.some((a) => a.id === running.id) ? (
          <SendProgress r={running} />
        ) : null}
        <Button
          className="w-full sm:w-auto"
          disabled={!canSend}
          onClick={() => setConfirming(true)}
        >
          {running ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Send to {people(recipients.length)}
        </Button>
        {!text && recipients.length ? (
          <p className="text-meta">Type the message first.</p>
        ) : !recipients.length ? (
          <p className="text-meta">Pick a group or type a number.</p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-section-title">Sent announcements</h2>
        {history.error ? (
          <ErrorState error={history.error} title="Couldn't load announcements" />
        ) : history.loading ? (
          <LoadingRows rows={2} />
        ) : !history.data.length ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements yet"
            description="Announcements you send appear here with how many people got them."
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {history.data.map((a) => (
              <HistoryRow key={a.id} a={a} running={running} onResend={() => void run(a)} />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Send to ${people(recipients.length)}?`}
        description={`Everyone gets it on WhatsApp now. Meta charges about ${money(recipients.length * rate)}. This can't be undone.`}
        confirmLabel="Send now"
        onConfirm={() => void send()}
      />
    </div>
  );
}

function SendProgress({ r }: { r: Running }) {
  return (
    <div className="space-y-1.5" role="status">
      <Progress value={r.total ? (r.done / r.total) * 100 : 0} aria-label="Sending progress" />
      <p className="text-meta">
        Sending {r.done} of {r.total}… keep this page open.
      </p>
    </div>
  );
}

function HistoryRow({
  a,
  running,
  onResend,
}: {
  a: Announcement;
  running: Running | null;
  onResend: () => void;
}) {
  const mine = running?.id === a.id;
  const to = [
    ...a.groups.map((g) => SEGMENT_META[g].label),
    ...(a.typedNumbers ? [`${a.typedNumbers} typed number${a.typedNumbers === 1 ? "" : "s"}`] : []),
  ].join(" + ");
  const unfinished = a.status === "sending" && !mine;
  return (
    <li className="surface-card space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta">
          {formatDate(a.createdAt)} {time.format(a.createdAt)} · {a.createdByName}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {a.status === "done" ? <StatusPill tone="success">{a.sent} sent</StatusPill> : null}
          {a.status === "done" && a.failed ? (
            <StatusPill tone="danger">{a.failed} not sent</StatusPill>
          ) : null}
          {unfinished ? <StatusPill tone="warning">Not finished</StatusPill> : null}
        </div>
      </div>
      <p className="line-clamp-3 text-sm">{a.message}</p>
      <p className="text-meta">
        To {to || "—"} · {a.total} {a.total === 1 ? "person" : "people"}
        {a.skipped ? ` · ${a.skipped} left out` : ""}
      </p>
      {mine && running ? (
        <SendProgress r={running} />
      ) : (a.status === "done" && a.failed) || unfinished ? (
        <Button size="sm" variant="outline" disabled={!!running} onClick={onResend}>
          <Send aria-hidden /> Send to the ones not reached
        </Button>
      ) : null}
    </li>
  );
}
