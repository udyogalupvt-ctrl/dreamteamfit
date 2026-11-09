import { useId, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Star,
  StickyNote,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { LoadingRows } from "@/components/common/loading-state";
import { usePeriodPicker } from "@/components/common/period-picker";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { UpiQr } from "@/components/pay/upi-qr";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAccess } from "@/hooks/use-access";
import { useAnonFeedbackBadge } from "@/hooks/use-feedback-badge";
import { useLive } from "@/hooks/use-live-query";
import {
  ANON_LIMITS,
  RATING_WORDS,
  anonSummary,
  feedbackUrl,
  hourWindow,
} from "@/lib/anon-feedback";
import { FEEDBACK_KINDS, feedbackKindLabel } from "@/lib/feedback";
import {
  downloadPosterPdf,
  downloadPosterPng,
  downloadQrPng,
  printPoster,
  type PosterInput,
} from "@/lib/feedback-poster";
import { choicesWith } from "@/lib/periods";
import {
  createFeedbackLink,
  deleteAnonFeedback,
  deleteFeedbackLink,
  renameFeedbackLink,
  saveAnonFeedbackNote,
  setAnonFeedbackResolved,
  setFeedbackLinkActive,
  subscribeAnonFeedbackBetween,
  subscribeFeedbackLinks,
  subscribeNewAnonFeedback,
} from "@/services/anon-feedback.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { StatTone } from "@/types";
import type { AnonFeedback, FeedbackKind, FeedbackLink } from "@/types/models";

const VIEWS = ["inbox", "qr"] as const;
const TABS = ["new", "resolved", "all"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/anonymous-feedback")({
  validateSearch: z.object({
    view: z.enum(VIEWS).optional(),
    tab: z.enum(TABS).optional(),
    link: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Anonymous feedback — REBUILD FITNESS" }] }),
  component: AnonFeedbackPage,
});

const KIND_TONE: Record<FeedbackKind, StatTone> = {
  complaint: "danger",
  idea: "info",
  praise: "success",
};

const errText = (e: unknown) =>
  e instanceof Error ? firestoreErrorMessage(e) : "Couldn't save. Try again.";

/** "Today, 7–8 pm" / "09 Nov 2026, 7–8 pm": messages keep only the hour. */
function sentAt(d: Date | null) {
  if (!d) return "Just now";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return `${sameDay ? "Today" : format(d, "dd MMM yyyy")}, ${hourWindow(d)}`;
}

function AnonFeedbackPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? "inbox";
  const links = useLive<FeedbackLink[]>(subscribeFeedbackLinks, [], []);
  const [naming, setNaming] = useState<FeedbackLink | "new" | null>(null);
  const newCount = useAnonFeedbackBadge();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anonymous feedback"
        description="Put a QR poster up in the gym. Anyone can scan it and write to you without giving a name or number."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Anonymous feedback" }]}
        actions={
          <Button onClick={() => setNaming("new")}>
            <Plus aria-hidden /> New QR
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(v) =>
            void navigate({
              search: (s) => ({ ...s, view: v as (typeof VIEWS)[number] }),
              replace: true,
            })
          }
        >
          <TabsList>
            <TabsTrigger value="inbox">
              Messages{newCount ? <span className="ml-1 tabular-nums">· {newCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="qr">
              QR posters
              {links.data.length ? (
                <span className="ml-1 tabular-nums">· {links.data.length}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Link
          to="/feedback"
          className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Feedback from the member app →
        </Link>
      </div>

      {view === "inbox" ? (
        <Inbox links={links.data} onNewQr={() => setNaming("new")} />
      ) : (
        <QrList
          links={links.data}
          loading={links.loading}
          error={links.error}
          onNew={() => setNaming("new")}
          onRename={setNaming}
        />
      )}
      {naming ? (
        <LinkNameDialog
          link={naming === "new" ? null : naming}
          onOpenChange={(v) => !v && setNaming(null)}
          onCreated={() => void navigate({ search: (s) => ({ ...s, view: "qr" }), replace: true })}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ messages

function Inbox({ links, onNewQr }: { links: FeedbackLink[]; onNewQr: () => void }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = search.tab ?? "new";
  const linkId = search.link ?? "all";
  const setSearch = (patch: { tab?: Tab; link?: string | undefined }) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
  const { period, picker } = usePeriodPicker(
    "month",
    choicesWith("lastMonth", "all"),
    "Sent between",
  );
  const [kind, setKind] = useState<"all" | FeedbackKind>("all");
  const [q, setQ] = useState("");
  const [noting, setNoting] = useState<AnonFeedback | null>(null);
  const [removing, setRemoving] = useState<AnonFeedback | null>(null);
  const { owner } = useAccess();

  const live = useLive<AnonFeedback[]>(
    tab === "new"
      ? subscribeNewAnonFeedback
      : (d, e) => subscribeAnonFeedbackBetween(period.from, period.to, d, e),
    [],
    [tab === "new", period.from, period.to],
  );

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return live.data.filter(
      (f) =>
        (tab === "all" || f.status === tab) &&
        (linkId === "all" || f.linkId === linkId) &&
        (kind === "all" || f.kind === kind) &&
        (!text || f.message.toLowerCase().includes(text) || f.note.toLowerCase().includes(text)),
    );
  }, [live.data, tab, linkId, kind, q]);
  const sum = anonSummary(rows);

  const remove = async () => {
    const item = removing;
    if (!item) return;
    setRemoving(null);
    try {
      await deleteAnonFeedback(item);
      toast.success("Message removed");
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setSearch({ tab: v as Tab })}>
          <TabsList>
            <TabsTrigger value="new">New</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[14rem_11rem_9rem_auto]">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search words…"
            label="Search messages"
          />
          <Select
            value={linkId}
            onValueChange={(v) => setSearch({ link: v === "all" ? undefined : v })}
          >
            <SelectTrigger aria-label="Filter by QR poster">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All QR posters</SelectItem>
              {links.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {FEEDBACK_KINDS.map((k) => (
                <SelectItem key={k.key} value={k.key}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tab !== "new" ? picker : null}
        </div>
      </div>

      {!live.loading && rows.length ? (
        <dl className="surface-card grid grid-cols-3 divide-x divide-border text-center">
          <div className="px-3 py-3">
            <dt className="text-meta">Messages</dt>
            <dd className="text-xl font-bold tabular-nums">{sum.total}</dd>
          </div>
          <div className="px-3 py-3">
            <dt className="text-meta">Average rating</dt>
            <dd className="text-xl font-bold tabular-nums">
              {sum.rated ? (
                <>
                  {sum.average.toFixed(1)}
                  <span className="text-sm font-medium text-muted-foreground"> / 5</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="px-3 py-3">
            <dt className="text-meta">Complaints</dt>
            <dd className="text-xl font-bold tabular-nums">{sum.complaints}</dd>
          </div>
        </dl>
      ) : null}

      {live.error ? <ErrorState error={live.error} title="Couldn't load messages" /> : null}
      {live.loading ? (
        <LoadingRows rows={3} />
      ) : !rows.length ? (
        <EmptyState
          icon={QrCode}
          title={
            !links.length
              ? "No QR poster yet"
              : tab === "new"
                ? "All caught up"
                : "No messages here"
          }
          description={
            !links.length
              ? "Make a QR, print it and stick it at the front desk or in the changing rooms. Messages show up here."
              : tab === "new"
                ? "No new anonymous messages."
                : "Nothing matches these filters."
          }
          action={
            !links.length ? (
              <Button onClick={onNewQr}>
                <Plus aria-hidden /> Make the first QR
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul aria-label="Anonymous messages" className="grid gap-3 xl:grid-cols-2">
          {rows.map((f) => (
            <MessageCard
              key={f.id}
              item={f}
              canRemove={owner}
              onNote={() => setNoting(f)}
              onRemove={() => setRemoving(f)}
            />
          ))}
        </ul>
      )}
      {noting ? <NoteDialog item={noting} onOpenChange={(v) => !v && setNoting(null)} /> : null}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove this message?"
        description="For spam or abuse only. It is deleted for good and can't be brought back. To close a real complaint, use Mark resolved."
        confirmLabel="Remove"
        destructive
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  if (!rating) return <span className="text-meta">Not rated</span>;
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`${rating} of 5: ${RATING_WORDS[rating]}`}
    >
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={
              i <= rating ? "size-4 fill-warning text-warning" : "size-4 text-muted-foreground/40"
            }
          />
        ))}
      </span>
      <span className="text-meta">{RATING_WORDS[rating]}</span>
    </span>
  );
}

function MessageCard({
  item: f,
  canRemove,
  onNote,
  onRemove,
}: {
  item: AnonFeedback;
  canRemove: boolean;
  onNote: () => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const resolve = async (resolved: boolean) => {
    setBusy(true);
    try {
      await setAnonFeedbackResolved(f, resolved);
      if (resolved)
        toast.success("Marked resolved", {
          action: { label: "Undo", onClick: () => void setAnonFeedbackResolved(f, false) },
        });
      else toast.success("Opened again");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="surface-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={KIND_TONE[f.kind]}>{feedbackKindLabel(f.kind)}</StatusPill>
        <Stars rating={f.rating} />
        {f.status === "resolved" ? (
          <StatusPill tone="success" className="ml-auto">
            Resolved
          </StatusPill>
        ) : null}
      </div>
      <p className="text-meta">{[f.linkName || "QR poster", sentAt(f.createdAt)].join(" · ")}</p>
      <p className="text-sm break-words whitespace-pre-wrap">{f.message}</p>
      {f.note ? (
        <div className="rounded-lg border-l-2 border-primary bg-accent/50 px-3 py-2 text-sm">
          <p className="text-meta">Staff note by {f.noteBy || "staff"} (only staff see it)</p>
          <p className="mt-1 break-words whitespace-pre-wrap">{f.note}</p>
        </div>
      ) : null}
      {f.status === "resolved" && f.resolvedBy ? (
        <p className="text-meta">
          Resolved by {f.resolvedBy}
          {f.resolvedAt ? ` · ${format(f.resolvedAt, "dd MMM yyyy, hh:mm a")}` : ""}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {f.status === "new" ? (
          <Button size="sm" disabled={busy} onClick={() => void resolve(true)}>
            <CheckCircle2 aria-hidden /> Mark resolved
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(false)}>
            <RotateCcw aria-hidden /> Open again
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onNote}>
          <StickyNote aria-hidden /> {f.note ? "Change note" : "Add note"}
        </Button>
        {canRemove ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 aria-hidden /> <span className="sr-only sm:not-sr-only">Spam</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function NoteDialog({
  item,
  onOpenChange,
}: {
  item: AnonFeedback;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState(item.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await saveAnonFeedbackNote(item, text);
      toast.success(text.trim() ? "Note saved" : "Note removed");
      onOpenChange(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Staff note"
      description="What was done about it. Only staff see this; the sender can't be told (we don't know who it was)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || text.trim() === item.note}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save note
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <blockquote className="rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
          {item.message}
        </blockquote>
        <Field
          label="Note"
          htmlFor={`${id}-note`}
          hint={`${text.trim().length} / ${ANON_LIMITS.note}`}
        >
          <Textarea
            id={`${id}-note`}
            value={text}
            maxLength={ANON_LIMITS.note}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Told the cleaning staff; checked again on Monday."
            className="field-sizing-content min-h-24"
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ QR posters

function QrList({
  links,
  loading,
  error,
  onNew,
  onRename,
}: {
  links: FeedbackLink[];
  loading: boolean;
  error: Error | null;
  onNew: () => void;
  onRename: (l: FeedbackLink) => void;
}) {
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const local = /^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(origin);
  const [removing, setRemoving] = useState<FeedbackLink | null>(null);
  const remove = async () => {
    const l = removing;
    if (!l) return;
    setRemoving(null);
    try {
      await deleteFeedbackLink(l);
      toast.success(`QR removed · ${l.name}`);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  if (error) return <ErrorState error={error} title="Couldn't load the QR posters" />;
  if (loading) return <LoadingRows rows={2} />;
  if (!links.length)
    return (
      <EmptyState
        icon={QrCode}
        title="No QR poster yet"
        description="Make one for each spot you want feedback from (front desk, changing room, cardio area). Each poster's messages are kept apart."
        action={
          <Button onClick={onNew}>
            <Plus aria-hidden /> Make the first QR
          </Button>
        }
      />
    );
  return (
    <div className="space-y-4">
      {local ? (
        <p role="status" className="surface-card flex items-start gap-2 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            You opened the app from <b>{origin}</b>, which members' phones can't reach. Open the app
            from its live address before printing, so the QR points there.
          </span>
        </p>
      ) : null}
      <ul aria-label="QR posters" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {links.map((l) => (
          <QrCard
            key={l.id}
            link={l}
            poster={{
              url: feedbackUrl(origin, l.id),
              gymName: business.data.businessName,
              place: l.name,
              logoUrl: business.data.logoUrl,
            }}
            onRename={() => onRename(l)}
            onRemove={() => setRemoving(l)}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Remove the QR "${removing?.name ?? ""}"?`}
        description="Nobody has written from it yet. A printed copy stops working."
        confirmLabel="Remove"
        destructive
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function QrCard({
  link: l,
  poster,
  onRename,
  onRemove,
}: {
  link: FeedbackLink;
  poster: PosterInput;
  onRename: () => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState("");
  const run = async (what: string, job: () => Promise<void>, done?: string) => {
    setBusy(what);
    try {
      await job();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy("");
    }
  };
  const toggle = (on: boolean) =>
    void run(
      "toggle",
      async () => {
        try {
          await setFeedbackLinkActive(l.id, on);
        } catch (e) {
          throw new Error(errText(e));
        }
      },
      on ? `${l.name} is on again` : `${l.name} switched off: scanning it shows "switched off"`,
    );
  const copy = () =>
    void run("copy", () => navigator.clipboard.writeText(poster.url), "Link copied");

  return (
    <li className="surface-card flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{l.name}</h2>
          <p className="text-meta tabular-nums">
            {l.responseCount === 1 ? "1 message" : `${l.responseCount} messages`}
            {l.lastResponseAt ? ` · last ${sentAt(l.lastResponseAt)}` : ""}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <span className={l.active ? "" : "text-muted-foreground"}>{l.active ? "On" : "Off"}</span>
          <Switch
            checked={l.active}
            disabled={busy === "toggle"}
            onCheckedChange={toggle}
            aria-label={`Take feedback from ${l.name}`}
          />
        </label>
      </div>
      <div className={l.active ? "" : "opacity-40 grayscale"}>
        <UpiQr uri={poster.url} label={`QR code for ${l.name}`} className="mx-auto w-44" />
      </div>
      <p className="truncate text-center text-meta" title={poster.url}>
        {poster.url.replace(/^https?:\/\//, "")}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() => void run("print", () => printPoster(poster))}
        >
          {busy === "print" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Printer aria-hidden />
          )}
          Print poster
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!!busy}>
              {busy === "dl" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              Download
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => void run("dl", () => downloadPosterPdf(poster))}>
              <FileText aria-hidden /> Poster · PDF (A4)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("dl", () => downloadPosterPng(poster))}>
              <ImageIcon aria-hidden /> Poster · PNG image
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("dl", () => downloadQrPng(poster))}>
              <QrCode aria-hidden /> QR code only · PNG
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-8"
              aria-label={`More for ${l.name}`}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={copy}>
              <Copy aria-hidden /> Copy link
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={poster.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden /> Open the page
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/anonymous-feedback" search={{ view: "inbox", tab: "all", link: l.id }}>
                <StickyNote aria-hidden /> See its messages
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil aria-hidden /> Rename
            </DropdownMenuItem>
            {l.responseCount === 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={onRemove}>
                  <Trash2 aria-hidden /> Remove
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function LinkNameDialog({
  link,
  onOpenChange,
  onCreated,
}: {
  link: FeedbackLink | null;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(link?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (link) {
        await renameFeedbackLink(link.id, name);
        toast.success("QR renamed", {
          description: "Print it again if the name is on the poster.",
        });
      } else {
        await createFeedbackLink(name);
        toast.success("QR ready", { description: "Print the poster and put it up." });
        onCreated();
      }
      onOpenChange(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={link ? "Rename QR" : "New feedback QR"}
      description="Name it after where the poster goes, so you know where each message came from. People who scan it see this name."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || name.trim().length < 2}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {link ? "Save" : "Make QR"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && name.trim().length >= 2) void save();
        }}
      >
        <Field label="Name" htmlFor={`${id}-name`} required error={error || undefined}>
          <Input
            id={`${id}-name`}
            value={name}
            autoFocus
            maxLength={ANON_LIMITS.linkName}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Front desk, Ladies changing room"
          />
        </Field>
      </form>
    </FormDialog>
  );
}
