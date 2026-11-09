import { useEffect, useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Link2Off, Loader2, Lock, PauseCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ANON_LIMITS, RATING_WORDS } from "@/lib/anon-feedback";
import { FEEDBACK_KINDS } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import type { FeedbackKind } from "@/types/models";

export const Route = createFileRoute("/f/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Anonymous feedback" },
      { name: "description", content: "Tell the gym what you think. No name, no phone number." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AnonFeedbackForm,
});

type Info = { on: boolean; gymName: string; logoUrl: string; place: string };
type State = "loading" | "invalid" | "off" | "form" | "sending" | "done";

const KIND_HINT: Record<FeedbackKind, string> = {
  complaint: "Something went wrong",
  idea: "Something to improve",
  praise: "Something you liked",
};

/**
 * A random id kept on this phone only, so one person can't flood the inbox. It is never stored
 * with the message; the server only uses a one-day keyed hash of it to count.
 */
function deviceId() {
  try {
    const k = "anon-fb-device";
    let v = localStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "";
  }
}

/** The public page behind a feedback QR poster. No login, nothing about the sender is kept. */
function AnonFeedbackForm() {
  const { token } = Route.useParams();
  const id = useId();
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<State>("loading");
  const [kind, setKind] = useState<FeedbackKind>("complaint");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`/api/feedback/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const i = (await r.json()) as Info;
        setInfo(i);
        setState(i.on ? "form" : "off");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const send = async () => {
    const text = message.trim();
    if (text.length < 3) {
      setError("Write a few words.");
      return;
    }
    setError("");
    setState("sending");
    try {
      const r = await fetch(`/api/feedback/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, rating, message: text, device: deviceId(), website }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) return setState("done");
      if (r.status === 409) return setState("off");
      if (r.status === 404) return setState("invalid");
      setError(body.error || "Couldn't send. Check your internet and try again.");
    } catch {
      setError("Couldn't send. Check your internet and try again.");
    }
    setState("form");
  };

  const gym = info?.gymName || "the gym";
  const shell = (children: React.ReactNode) => (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <div className="surface-card w-full max-w-md space-y-6 p-6 sm:p-8">
        {info ? (
          <header className="flex items-center gap-3">
            {info.logoUrl ? (
              <img
                src={info.logoUrl}
                alt=""
                className="size-11 shrink-0 rounded-xl object-contain"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-bold">{gym}</p>
              {info.place ? <p className="truncate text-meta">{info.place}</p> : null}
            </div>
          </header>
        ) : null}
        {children}
      </div>
    </main>
  );

  if (state === "loading")
    return (
      <main className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    );
  if (state === "invalid")
    return shell(
      <div className="space-y-2 text-center">
        <Link2Off className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="font-display text-xl font-bold">This link doesn't work</h1>
        <p className="text-sm text-muted-foreground">
          The QR may be old or mistyped. Please scan the poster again or ask at the front desk.
        </p>
      </div>,
    );
  if (state === "off")
    return shell(
      <div className="space-y-2 text-center">
        <PauseCircle className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="font-display text-xl font-bold">This QR is switched off</h1>
        <p className="text-sm text-muted-foreground">
          {gym} isn't taking feedback from this poster right now. Please ask at the front desk.
        </p>
      </div>,
    );
  if (state === "done")
    return shell(
      <div className="space-y-3 text-center" role="status">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h1 className="font-display text-2xl font-bold">Thank you!</h1>
        <p className="text-sm text-muted-foreground">
          {gym} got your message. Nobody can see who sent it.
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            setMessage("");
            setRating(0);
            setState("form");
          }}
        >
          Write another
        </Button>
      </div>,
    );

  const sending = state === "sending";
  const left = ANON_LIMITS.message - message.length;
  return shell(
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sending) void send();
      }}
      noValidate
    >
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-balance">Tell us honestly</h1>
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            100% anonymous. No name, no phone number, no login. We only keep the hour it was sent,
            not the exact time.
          </span>
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">What is it about?</legend>
        <div className="grid grid-cols-3 gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <label
              key={k.key}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border px-2 py-3 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                kind === k.key
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              <input
                type="radio"
                name={`${id}-kind`}
                value={k.key}
                checked={kind === k.key}
                onChange={() => setKind(k.key)}
                className="sr-only"
              />
              <span className="text-sm font-semibold">{k.label}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {KIND_HINT[k.key]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">
          How is {gym} overall?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded-lg p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name={`${id}-rating`}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                onClick={() => rating === n && setRating(0)}
                className="sr-only"
                aria-label={`${n} of 5: ${RATING_WORDS[n]}`}
              />
              <Star
                aria-hidden
                className={cn(
                  "size-9 transition-colors",
                  n <= rating ? "fill-warning text-warning" : "text-muted-foreground/40",
                )}
              />
            </label>
          ))}
          <span className="ml-2 text-sm text-muted-foreground" aria-live="polite">
            {rating ? RATING_WORDS[rating] : ""}
          </span>
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={`${id}-msg`} className="text-sm font-semibold">
          Your message
        </label>
        <Textarea
          id={`${id}-msg`}
          value={message}
          maxLength={ANON_LIMITS.message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            kind === "complaint"
              ? "e.g. The washroom near the cardio area was not clean this evening."
              : kind === "idea"
                ? "e.g. Please add one more squat rack in the evening rush."
                : "e.g. The morning trainer is really helpful."
          }
          className="field-sizing-content min-h-32 text-base"
          aria-invalid={!!error || undefined}
          aria-describedby={`${id}-count`}
        />
        <p id={`${id}-count`} className="text-right text-meta tabular-nums">
          {left < 200 ? `${left} characters left` : "Write in any language"}
        </p>
      </div>

      {/* People never see this box; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={sending}>
        {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Send anonymously
      </Button>
    </form>,
  );
}
