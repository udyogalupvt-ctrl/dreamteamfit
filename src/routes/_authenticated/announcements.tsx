import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  EyeOff,
  Loader2,
  Megaphone,
  MessageCircle,
  Pencil,
  RotateCcw,
  Send,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FormDialog } from "@/components/common/form-dialog";
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
import { CHANNEL_LABEL, appAudience, cleanAppMessage } from "@/lib/app-announcement";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "@/lib/firestore";
import { formatDate } from "@/lib/format";
import { SEGMENT_META } from "@/lib/member-segments";
import { cn } from "@/lib/utils";
import {
  HISTORY_MAX,
  createAnnouncement,
  editAppAnnouncement,
  notifyAnnouncement,
  removeFromApp,
  runAnnouncement,
  showInAppAgain,
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
  sendsFromPhone,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import {
  ANNOUNCEMENT_GROUPS,
  type Announcement,
  type AnnouncementChannel,
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
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const members = (n: number) => `${n} member${n === 1 ? "" : "s"}`;
const hasApp = (c: Client) => !!c.portalCode && c.portalActive !== false;

type Running = { id: string; done: number; total: number };

/**
 * News for members: in the member app only (free, with a phone notification), or also on WhatsApp
 * (Meta charges each). Each number gets the WhatsApp message once.
 */
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
  const [channel, setChannel] = useState<AnnouncementChannel>("app");
  const [groups, setGroups] = useState<AnnouncementGroup[]>([]);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
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

  // WhatsApp announcements go only through the Meta Cloud API, never from the gym's own number.
  const fromPhone = sendsFromPhone(wa.data);
  const live = isWhatsAppApiLive(wa.data) && !fromPhone;
  const viaWhatsApp = channel === "whatsapp" && live;
  const gym = business.data.businessName || "our gym";
  const { recipients, leftOut, invalid } = useMemo(
    () =>
      viaWhatsApp
        ? buildRecipients(segments, groups, typed, clients.data, wa.data.defaultCountryCode)
        : { recipients: [], leftOut: [], invalid: [] },
    [viaWhatsApp, segments, groups, typed, clients.data, wa.data.defaultCountryCode],
  );
  // The app copy reaches every chosen member, also the ones who said no to WhatsApp.
  const audience = useMemo(
    () =>
      appAudience(
        segments,
        groups,
        recipients.map((r) => r.clientId),
      ),
    [segments, groups, recipients],
  );
  const withApp = useMemo(() => {
    const ids = new Set(audience);
    return clients.data.filter((c) => ids.has(c.id) && hasApp(c)).length;
  }, [audience, clients.data]);
  const text = viaWhatsApp ? cleanMessage(message) : cleanAppMessage(message);
  const reach = viaWhatsApp ? recipients.length : audience.length;
  const busy = !!running || posting;
  const canSend = !!user && reach > 0 && text.length > 0 && !busy;

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

  const reset = () => {
    setMessage("");
    setTyped("");
    setGroups([]);
  };

  const send = async () => {
    setConfirming(false);
    if (!canSend || !user) return;
    const by = { uid: user.uid, name: user.displayName || user.email || "Staff" };
    if (!viaWhatsApp) {
      setPosting(true);
      try {
        const id = await createAnnouncement(
          {
            channel: "app",
            message: text,
            groups,
            typedNumbers: 0,
            recipients: [],
            skipped: 0,
            appClientIds: audience,
          },
          by,
        );
        reset();
        const phones = await notifyAnnouncement(id).catch(() => 0);
        toast.success(`Posted in the member app for ${members(audience.length)}`, {
          description: phones
            ? `Notification sent to ${phones} phone${phones === 1 ? "" : "s"}.`
            : "No phone has notifications on, so it waits in their app.",
        });
      } catch (e) {
        toast.error("Announcement not posted", { description: firestoreErrorMessage(e) });
      } finally {
        setPosting(false);
      }
      return;
    }
    setRunning({ id: "", done: 0, total: recipients.length });
    try {
      const id = await createAnnouncement(
        {
          channel: "whatsapp",
          message: text,
          groups,
          typedNumbers: splitNumbers(typed).length - invalid.length,
          recipients,
          skipped: leftOut.length,
          appClientIds: audience,
        },
        by,
      );
      reset();
      // Free: the app copy's notification, for members who turned them on.
      void notifyAnnouncement(id).catch(() => undefined);
      await run({ id, message: text, recipients });
    } catch (e) {
      setRunning(null);
      toast.error("Announcement not sent", { description: firestoreErrorMessage(e) });
    }
  };

  const remove = (a: Announcement) =>
    void removeFromApp(a).then(
      () =>
        toast.success("Removed from the member app", {
          action: {
            label: "Undo",
            onClick: () =>
              void showInAppAgain({ id: a.id, removedClientIds: a.appClientIds }).catch((e) =>
                toast.error(firestoreErrorMessage(e)),
              ),
          },
        }),
      (e) => toast.error(firestoreErrorMessage(e)),
    );

  const restore = (a: Announcement) =>
    void showInAppAgain(a).then(
      () => toast.success("Showing in the member app again"),
      (e) => toast.error(firestoreErrorMessage(e)),
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="News for members: in their member app for free, or on WhatsApp too."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Announcements" }]}
      />
      {error ? <ErrorState error={error} title="Couldn't load members" /> : null}

      <section className="surface-card space-y-4 p-4 sm:p-5">
        <h2 className="text-section-title">1. How it goes out</h2>
        <div role="radiogroup" aria-label="How it goes out" className="grid gap-2 sm:grid-cols-2">
          <ChannelCard
            on={channel === "app"}
            onPick={() => setChannel("app")}
            icon={Smartphone}
            title="Member app only"
            price="Free"
            hint="Shows in Announcements in their app, with a notification on phones that turned them on."
          />
          <ChannelCard
            on={channel === "whatsapp"}
            disabled={!wa.loading && !live}
            onPick={() => setChannel("whatsapp")}
            icon={MessageCircle}
            title="WhatsApp + member app"
            price={`~${money(rate)} each`}
            hint="Also a WhatsApp message to each number (Meta charges each one)."
          />
        </div>
        {!wa.loading && fromPhone ? (
          <p className="text-meta">
            WhatsApp is off for announcements: messages go from the gym&apos;s own number, which
            sends only bills and member app links. Messages to many people are what get a number
            blocked.
          </p>
        ) : !wa.loading && !live ? (
          <p className="text-meta">
            WhatsApp is off for announcements.{" "}
            <Link to="/settings" className="font-semibold text-primary hover:underline">
              Turn on automatic WhatsApp in Settings
            </Link>{" "}
            to send them there too.
          </p>
        ) : null}
      </section>

      <section className="surface-card space-y-4 p-4 sm:p-5">
        <h2 className="text-section-title">2. Who gets it</h2>
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
        {viaWhatsApp ? (
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
        ) : null}
      </section>

      <section className="surface-card space-y-4 p-4 sm:p-5">
        <h2 className="text-section-title">3. Message</h2>
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
            {text.length} / {ANNOUNCEMENT_MAX} · Keep it short.
            {viaWhatsApp ? " Line breaks become spaces (a WhatsApp rule)." : ""}
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold">What they will see</p>
          {viaWhatsApp ? (
            <div className="space-y-2">
              <div className="max-w-md rounded-2xl rounded-tl-sm bg-success/10 p-3 text-sm whitespace-pre-line ring-1 ring-success/20">
                {announcementText(
                  recipients[0]?.name || "Ravi",
                  gym,
                  text || "Your message will appear here.",
                )}
              </div>
              <p className="text-meta">The same message also shows in their member app.</p>
            </div>
          ) : (
            <AppPreview gym={gym} text={text} />
          )}
        </div>
      </section>

      <section className="surface-card space-y-3 p-4 sm:p-5">
        <h2 className="text-section-title">4. Send</h2>
        {viaWhatsApp ? (
          <p className="text-sm">
            Goes to <strong>{people(recipients.length)}</strong> on WhatsApp
            {recipients.length ? (
              <span className="text-muted-foreground">
                {" "}
                · Meta charges about {money(recipients.length * rate)} (Marketing, ~{money(rate)}{" "}
                each)
              </span>
            ) : null}
          </p>
        ) : null}
        <p className={viaWhatsApp ? "text-meta" : "text-sm"}>
          Shows in the member app of <strong>{members(audience.length)}</strong>
          {audience.length ? (
            <span className="text-muted-foreground">
              {" "}
              · {withApp} {withApp === 1 ? "has" : "have"} the app now; the others see it once they
              get it
            </span>
          ) : null}
        </p>
        {leftOut.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {leftOut.length} left out of WhatsApp (said no to WhatsApp or no valid number)
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
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : viaWhatsApp ? (
            <Send aria-hidden />
          ) : (
            <Megaphone aria-hidden />
          )}
          {viaWhatsApp
            ? `Send to ${people(recipients.length)}`
            : `Post to ${members(audience.length)}`}
        </Button>
        {!text && reach ? (
          <p className="text-meta">Type the message first.</p>
        ) : !reach ? (
          <p className="text-meta">
            {viaWhatsApp ? "Pick a group or type a number." : "Pick a group."}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-section-title">Past announcements</h2>
        {history.error ? (
          <ErrorState error={history.error} title="Couldn't load announcements" />
        ) : history.loading ? (
          <LoadingRows rows={2} />
        ) : !history.data.length ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements yet"
            description="Announcements you post appear here with who got them."
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2" aria-label="Past announcements">
            {history.data.map((a) => (
              <HistoryRow
                key={a.id}
                a={a}
                running={running}
                onResend={() => void run(a)}
                onEdit={() => setEditing(a)}
                onRemove={() => remove(a)}
                onRestore={() => restore(a)}
              />
            ))}
          </ul>
        )}
        {history.data.length >= HISTORY_MAX ? (
          <p className="text-meta">Showing the newest {HISTORY_MAX}.</p>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          viaWhatsApp
            ? `Send to ${people(recipients.length)}?`
            : `Post to ${members(audience.length)}?`
        }
        description={
          viaWhatsApp
            ? `Everyone gets it on WhatsApp now. Meta charges about ${money(recipients.length * rate)}. This can't be undone.`
            : "It shows in their member app now, with a notification on phones that turned them on. You can change or remove it later."
        }
        confirmLabel={viaWhatsApp ? "Send now" : "Post now"}
        {...(viaWhatsApp ? { typeToConfirm: "SEND" } : {})}
        onConfirm={() => void send()}
      />
      {editing ? <EditDialog a={editing} gym={gym} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ChannelCard({
  on,
  disabled,
  onPick,
  icon: Icon,
  title,
  price,
  hint,
}: {
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
  icon: typeof Smartphone;
  title: string;
  price: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        on ? "border-primary bg-primary/10" : "border-border enabled:hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block font-bold">
          {title} · <span className="font-semibold text-muted-foreground">{price}</span>
        </span>
        <span className="text-meta">{hint}</span>
      </span>
    </button>
  );
}

/** Looks like the card on the member app's Home. */
function AppPreview({ gym, text, when = "Today" }: { gym: string; text: string; when?: string }) {
  return (
    <div className="max-w-md rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Megaphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-bold">From {gym}</p>
          <p className="text-meta">{when}</p>
        </div>
      </div>
      <p
        className={cn(
          "mt-3 text-sm break-words whitespace-pre-wrap",
          !text && "text-muted-foreground",
        )}
      >
        {text || "Your message will appear here."}
      </p>
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
  onEdit,
  onRemove,
  onRestore,
}: {
  a: Announcement;
  running: Running | null;
  onResend: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  const mine = running?.id === a.id;
  const app = a.channel === "app";
  const to = [
    ...a.groups.map((g) => SEGMENT_META[g].label),
    ...(a.typedNumbers ? [`${a.typedNumbers} typed number${a.typedNumbers === 1 ? "" : "s"}`] : []),
  ].join(" + ");
  const unfinished = !app && a.status === "sending" && !mine;
  const inApp = a.appClientIds.length;
  const removed = !inApp && a.removedClientIds.length > 0;
  return (
    <li className="surface-card space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta">
          {formatDate(a.createdAt)} {time.format(a.createdAt)} · {a.createdByName}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone="info">{CHANNEL_LABEL[a.channel]}</StatusPill>
          {!app && a.status === "done" ? (
            <StatusPill tone="success">{a.sent} sent</StatusPill>
          ) : null}
          {!app && a.status === "done" && a.failed ? (
            <StatusPill tone="danger">{a.failed} not sent</StatusPill>
          ) : null}
          {unfinished ? <StatusPill tone="warning">Not finished</StatusPill> : null}
          {removed ? <StatusPill tone="warning">Removed from the app</StatusPill> : null}
        </div>
      </div>
      <p className="line-clamp-4 text-sm break-words whitespace-pre-wrap">{a.message}</p>
      <p className="text-meta">
        To {to || "—"}
        {app ? "" : ` · ${people(a.total)} on WhatsApp`}
        {!app && a.skipped ? ` · ${a.skipped} left out` : ""}
        {inApp ? ` · in the app of ${members(inApp)}` : ""}
        {inApp && a.pushed !== null
          ? ` · notification on ${a.pushed} phone${a.pushed === 1 ? "" : "s"}`
          : ""}
      </p>
      {a.editedAt ? (
        <p className="text-meta">
          Changed {formatDate(a.editedAt)} by {a.editedByName}
        </p>
      ) : null}
      {removed && a.removedAt ? (
        <p className="text-meta">
          Removed {formatDate(a.removedAt)} by {a.removedByName}
        </p>
      ) : null}
      {mine && running ? <SendProgress r={running} /> : null}
      <div className="flex flex-wrap gap-2">
        {!mine && ((!app && a.status === "done" && a.failed) || unfinished) ? (
          <Button size="sm" variant="outline" disabled={!!running} onClick={onResend}>
            <Send aria-hidden /> Send to the ones not reached
          </Button>
        ) : null}
        {app && inApp ? (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil aria-hidden /> Edit
          </Button>
        ) : null}
        {inApp ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <EyeOff aria-hidden /> Remove from app
          </Button>
        ) : null}
        {removed ? (
          <Button size="sm" variant="outline" onClick={onRestore}>
            <RotateCcw aria-hidden /> Show in the app again
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Fix a member app announcement after posting. No new notification goes out. */
function EditDialog({ a, gym, onClose }: { a: Announcement; gym: string; onClose: () => void }) {
  const [message, setMessage] = useState(a.message);
  const [busy, setBusy] = useState(false);
  const text = cleanAppMessage(message);
  const save = async () => {
    setBusy(true);
    try {
      await editAppAnnouncement(a, message);
      toast.success("Announcement changed", { description: "Members see the new text." });
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open
      onOpenChange={(v) => !busy && !v && onClose()}
      title="Change announcement"
      description="Members see the new text in their app. No new notification is sent."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !text || text === cleanAppMessage(a.message)}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ann-edit">Announcement</Label>
          <Textarea
            id="ann-edit"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, ANNOUNCEMENT_MAX))}
            rows={5}
          />
          <p className="text-meta">
            {text.length} / {ANNOUNCEMENT_MAX}
          </p>
        </div>
        <AppPreview gym={gym} text={text} when={`${formatDate(a.createdAt)} · edited`} />
      </div>
    </FormDialog>
  );
}
