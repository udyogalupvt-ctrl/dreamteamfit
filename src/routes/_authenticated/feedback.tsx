import { useId, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  MessageSquareHeart,
  Phone,
  Reply,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { LoadingRows } from "@/components/common/loading-state";
import { usePeriodPicker } from "@/components/common/period-picker";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFeedbackBadge } from "@/hooks/use-feedback-badge";
import { useLive } from "@/hooks/use-live-query";
import { FEEDBACK_KINDS, FEEDBACK_LIMITS, feedbackKindLabel } from "@/lib/feedback";
import { choicesWith } from "@/lib/periods";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import {
  replyToFeedback,
  setFeedbackResolved,
  subscribeFeedbackBetween,
  subscribeMemberFeedback,
  subscribeNewFeedback,
} from "@/services/feedback.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import type { StatTone } from "@/types";
import type { Feedback, FeedbackKind } from "@/types/models";

const TABS = ["new", "resolved", "all"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/feedback")({
  validateSearch: z.object({
    client: z.string().optional(),
    tab: z.enum(TABS).optional(),
  }),
  head: () => ({ meta: [{ title: "Member feedback — REBUILD FITNESS" }] }),
  component: FeedbackPage,
});

const KIND_TONE: Record<FeedbackKind, StatTone> = {
  complaint: "danger",
  idea: "info",
  praise: "success",
};

const when = (d: Date | null) => (d ? format(d, "dd MMM yyyy, hh:mm a") : "Just now");

function FeedbackPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clientId = search.client ?? "";
  const tab: Tab = search.tab ?? (clientId ? "all" : "new");
  const setTab = (t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true });
  const newCount = useFeedbackBadge();
  const { period, picker } = usePeriodPicker(
    "month",
    choicesWith("lastMonth", "all"),
    "Sent between",
  );
  const [kind, setKind] = useState<"all" | FeedbackKind>("all");
  const [q, setQ] = useState("");
  const [replying, setReplying] = useState<Feedback | null>(null);

  // One member: all their messages. New: everything still open, however old. Otherwise a period.
  const live = useLive<Feedback[]>(
    clientId
      ? (d, e) => subscribeMemberFeedback(clientId, d, e)
      : tab === "new"
        ? subscribeNewFeedback
        : (d, e) => subscribeFeedbackBetween(period.from, period.to, d, e),
    [],
    [clientId, tab === "new", period.from, period.to],
  );

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    const digits = text.replace(/\D/g, "");
    return live.data.filter(
      (f) =>
        (tab === "all" || f.status === tab) &&
        (kind === "all" || f.kind === kind) &&
        (!text ||
          f.clientName.toLowerCase().includes(text) ||
          f.message.toLowerCase().includes(text) ||
          f.memberCode.toLowerCase() === text ||
          (digits.length >= 3 && f.phone.replace(/\D/g, "").includes(digits))),
    );
  }, [live.data, tab, kind, q]);

  const memberName = clientId ? (live.data[0]?.clientName ?? "this member") : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member feedback"
        description="Complaints, ideas and praise members send from their app. Your reply shows in their app, with a notification."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Member feedback" }]}
      />
      {clientId ? (
        <p className="surface-card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          <span>
            Showing messages from{" "}
            <Link
              to="/clients/$clientId"
              params={{ clientId }}
              className="font-semibold hover:underline"
            >
              {memberName}
            </Link>{" "}
            only.
          </span>
          <Link to="/feedback" search={{}} className="font-medium text-primary hover:underline">
            Show everyone
          </Link>
        </p>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="new">
              New{newCount ? <span className="tabular-nums"> · {newCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid gap-2 sm:grid-cols-[16rem_10rem_auto]">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search name, phone or words…"
            label="Search feedback"
          />
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
          {!clientId && tab !== "new" ? picker : null}
        </div>
      </div>

      {live.error ? <ErrorState error={live.error} title="Couldn't load feedback" /> : null}
      {live.loading ? (
        <LoadingRows rows={3} />
      ) : !rows.length ? (
        <EmptyState
          icon={MessageSquareHeart}
          title={tab === "new" ? "All caught up" : "No messages here"}
          description={
            tab === "new"
              ? "No new messages from members. They write from the Feedback tab in their app."
              : "Nothing matches these filters."
          }
        />
      ) : (
        <ul aria-label="Messages" className="grid gap-3 xl:grid-cols-2">
          {rows.map((f) => (
            <FeedbackCard key={f.id} item={f} onReply={() => setReplying(f)} />
          ))}
        </ul>
      )}
      {replying ? (
        <ReplyDialog item={replying} onOpenChange={(v) => !v && setReplying(null)} />
      ) : null}
    </div>
  );
}

function FeedbackCard({ item: f, onReply }: { item: Feedback; onReply: () => void }) {
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const phone = normalizeWhatsAppPhone(f.phone, wa.data.defaultCountryCode);
  const [busy, setBusy] = useState(false);
  const resolve = async (resolved: boolean) => {
    setBusy(true);
    try {
      await setFeedbackResolved(f, resolved);
      if (resolved)
        toast.success(`Marked resolved · ${f.clientName}`, {
          action: { label: "Undo", onClick: () => void setFeedbackResolved(f, false) },
        });
      else toast.success(`Opened again · ${f.clientName}`);
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="surface-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={KIND_TONE[f.kind]}>{feedbackKindLabel(f.kind)}</StatusPill>
        {f.wantsCall ? <StatusPill tone="warning">Wants a call</StatusPill> : null}
        {f.status === "resolved" ? (
          <StatusPill tone="success" className="ml-auto">
            Resolved
          </StatusPill>
        ) : null}
      </div>
      <div className="min-w-0">
        <Link
          to="/clients/$clientId"
          params={{ clientId: f.clientId }}
          className="font-semibold hover:underline"
        >
          {f.clientName || "Member"}
        </Link>
        <p className="text-meta tabular-nums">
          {[f.memberCode, f.phone, when(f.createdAt)].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p className="text-sm break-words whitespace-pre-wrap">{f.message}</p>
      {f.reply ? (
        <div className="rounded-lg border-l-2 border-primary bg-accent/50 px-3 py-2 text-sm">
          <p className="text-meta">
            Reply by {f.repliedBy || "staff"} · {when(f.repliedAt)}
          </p>
          <p className="mt-1 break-words whitespace-pre-wrap">{f.reply}</p>
        </div>
      ) : null}
      {f.status === "resolved" && f.resolvedBy ? (
        <p className="text-meta">
          Resolved by {f.resolvedBy} · {when(f.resolvedAt)}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant={f.reply ? "outline" : "default"} onClick={onReply}>
          <Reply aria-hidden /> {f.reply ? "Change reply" : "Reply"}
        </Button>
        {f.status === "new" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve(true)}>
            <CheckCircle2 aria-hidden /> Mark resolved
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(false)}>
            <RotateCcw aria-hidden /> Open again
          </Button>
        )}
        {f.phone ? (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${phone.ok ? `+${phone.value}` : f.phone}`}>
              <Phone aria-hidden /> Call
            </a>
          </Button>
        ) : null}
        {phone.ok ? (
          <Button asChild size="sm" variant="outline">
            <a href={`https://wa.me/${phone.value}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden className="text-[#128C7E] dark:text-[#25D366]" /> WhatsApp
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ReplyDialog({
  item,
  onOpenChange,
}: {
  item: Feedback;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState(item.reply);
  const [keepOpen, setKeepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await replyToFeedback(item, text, keepOpen);
      toast.success(`Reply sent to ${item.clientName}`, {
        description: keepOpen ? "Still in New." : "Moved to Resolved.",
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? firestoreErrorMessage(e) : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={`Reply to ${item.clientName || "member"}`}
      description="They see it in the Feedback tab of their app and get a notification."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Send reply
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <blockquote className="rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
          {item.message}
        </blockquote>
        <Field
          label="Your reply"
          htmlFor={`${id}-reply`}
          hint={`${text.trim().length} / ${FEEDBACK_LIMITS.reply}`}
        >
          <Textarea
            id={`${id}-reply`}
            value={text}
            maxLength={FEEDBACK_LIMITS.reply}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Thanks for telling us. The AC is fixed from today."
            className="field-sizing-content min-h-24"
          />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={keepOpen}
            onCheckedChange={(v) => setKeepOpen(v === true)}
            className="mt-0.5"
          />
          <span>
            Keep it in New
            <span className="block text-meta">For when you still have to follow up.</span>
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
