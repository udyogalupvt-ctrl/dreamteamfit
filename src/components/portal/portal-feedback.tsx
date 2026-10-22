import { useEffect, useState } from "react";
import { ExternalLink, Loader2, MessageSquareHeart, Send, Star } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { PortalFeedback, PortalReview } from "@/constants/portal";
import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  cleanFeedback,
  feedbackKindLabel,
  validateFeedback,
} from "@/lib/feedback";
import { portalCall } from "@/lib/portal-firebase";
import { cn } from "@/lib/utils";
import type { FeedbackKind } from "@/types/models";
import { day } from "./portal-shell";

/**
 * Home's "Rate us on Google" card (src/lib/review-prompt.ts decides when). Either answer hides it
 * at once; the server notes it so it doesn't come back (tapped) or comes back in 60 days (Not now).
 */
export function ReviewCard({
  review,
  gymName,
  onDone,
}: {
  review: PortalReview;
  gymName: string;
  onDone: () => void;
}) {
  const answer = (action: "tapped" | "later") => {
    onDone();
    void portalCall("/api/portal/review", { action }).catch(() => undefined);
  };
  return (
    <section className="surface-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning text-warning-foreground">
          <Star className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Enjoying {gymName}?</h2>
          <p className="text-meta">
            A few words on Google help other people find a good gym. It takes a minute.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <a
            href={review.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => answer("tapped")}
          >
            <Star aria-hidden /> Rate us on Google
          </a>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => answer("later")}>
          Not now
        </Button>
      </div>
    </section>
  );
}

/** Home's way in to the Feedback screen. */
export function FeedbackLink({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-left text-sm hover:bg-accent"
    >
      <MessageSquareHeart className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="flex-1">Complaint, idea or praise? Tell the owner</span>
      <span className="font-semibold">Write</span>
    </button>
  );
}

const KIND_TONE = { complaint: "danger", idea: "info", praise: "success" } as const;

/** Member app → Feedback: write to the owner, and read the gym's replies. */
export function FeedbackView({ review }: { review: PortalReview | null }) {
  const [items, setItems] = useState<PortalFeedback[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [wantsCall, setWantsCall] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoadError("");
    portalCall<{ items: PortalFeedback[] }>("/api/portal/feedback")
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Couldn't load."));
  };
  useEffect(load, []);

  const send = async () => {
    const input = cleanFeedback({ kind, message, wantsCall });
    const problem = validateFeedback(input);
    if (problem) return void toast.error(problem);
    setBusy(true);
    try {
      const { item } = await portalCall<{ item: PortalFeedback }>("/api/portal/feedback", input);
      setItems((list) => [item, ...(list ?? [])]);
      setMessage("");
      setWantsCall(false);
      toast.success("Sent to the owner", {
        description: input.wantsCall ? "They'll call you back." : "Their reply will show here.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="surface-card space-y-4 p-4">
        <div>
          <h2 className="text-card-title">Tell the owner</h2>
          <p className="text-meta">Only the gym's owner and managers read this.</p>
        </div>
        <div role="radiogroup" aria-label="What is it about?" className="flex flex-wrap gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={kind === k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                "min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors",
                kind === k.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Textarea
            aria-label="Your message"
            value={message}
            maxLength={FEEDBACK_LIMITS.message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              kind === "complaint"
                ? "What went wrong? e.g. The AC in the cardio room isn't working."
                : kind === "praise"
                  ? "What did you like?"
                  : "What would make the gym better for you?"
            }
            className="field-sizing-content min-h-28"
          />
          <p className="text-meta text-right tabular-nums">
            {message.trim().length} / {FEEDBACK_LIMITS.message}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={wantsCall} onCheckedChange={(v) => setWantsCall(v === true)} />
          Please call me about this
        </label>
        <Button className="w-full" onClick={() => void send()} disabled={busy || !message.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Send
        </Button>
      </section>

      {review?.url ? (
        <a
          href={review.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => void portalCall("/api/portal/review", { action: "tapped" }).catch(() => 0)}
          className="surface-card flex items-center gap-3 p-4 text-sm hover:bg-accent"
        >
          <Star className="size-5 shrink-0 text-warning" aria-hidden />
          <span className="flex-1 font-semibold">Rate us on Google</span>
          <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
        </a>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-card-title px-1">Your messages</h2>
        {loadError ? (
          <div className="surface-card space-y-2 p-4 text-sm">
            <p>{loadError}</p>
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          </div>
        ) : items === null ? (
          <div className="surface-card flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : !items.length ? (
          <p className="surface-card p-4 text-sm text-muted-foreground">
            Nothing sent yet. Replies from the gym show here.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((f) => (
              <li key={f.id} className="surface-card space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={KIND_TONE[f.kind as FeedbackKind] ?? "info"}>
                    {feedbackKindLabel(f.kind)}
                  </StatusPill>
                  <span className="text-meta">{day(f.sentOn)}</span>
                  <span className="text-meta ml-auto">
                    {f.reply ? "Replied" : f.status === "resolved" ? "Seen" : "Sent"}
                  </span>
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{f.message}</p>
                {f.reply ? (
                  <div className="rounded-lg border-l-2 border-primary bg-accent/50 px-3 py-2 text-sm">
                    <p className="text-meta">Reply from the gym · {day(f.repliedOn)}</p>
                    <p className="mt-1 break-words whitespace-pre-wrap">{f.reply}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
