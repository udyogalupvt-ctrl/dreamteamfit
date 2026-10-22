import { useEffect, useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Clock,
  Copy,
  Loader2,
  MessageSquareWarning,
  Smartphone,
} from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { UpiQr } from "@/components/pay/upi-qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicPayLink } from "@/constants/portal";
import { formatPrice } from "@/lib/format";
import { cleanUtr } from "@/lib/pay-links";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pay/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pay by UPI" },
      { name: "description", content: "Pay your gym by UPI." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PayPage,
});

type Load = { link: PublicPayLink | null; error: string };

async function call(token: string, body?: { action: "paid"; utr: string }) {
  const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
    method: body ? "POST" : "GET",
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = (await res.json().catch(() => ({}))) as PublicPayLink & { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

/**
 * The member pays the gym by UPI (src/server/pay-links.ts works out the amount every time): a UPI
 * app link, a QR and the UPI ID to copy, then "I've paid" for the desk to confirm.
 */
function PayPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<Load | null>(null);
  useEffect(() => {
    let live = true;
    call(token)
      .then((link) => live && setState({ link, error: "" }))
      .catch((e: Error) => live && setState({ link: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [token]);
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-6 text-foreground sm:py-10">
      <div className="mx-auto grid w-full max-w-md gap-4">
        <div className="flex items-center justify-between gap-3">
          {typeof window !== "undefined" && window.history.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => window.history.back()}
            >
              <ArrowLeft aria-hidden /> Back
            </Button>
          ) : (
            <span />
          )}
          <BrandMark className="size-9" />
        </div>
        {!state ? (
          <div className="grid place-items-center rounded-2xl border border-border bg-card p-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : state.link ? (
          <PayCard
            token={token}
            link={state.link}
            onChange={(link) => setState({ link, error: "" })}
          />
        ) : (
          <Notice tone="muted" title="Link not found">
            {state.error}
          </Notice>
        )}
      </div>
    </main>
  );
}

function PayCard({
  token,
  link,
  onChange,
}: {
  token: string;
  link: PublicPayLink;
  onChange: (l: PublicPayLink) => void;
}) {
  const what =
    link.kind === "renewal"
      ? `Renewal · ${link.packageName}`
      : `Balance on bill ${link.invoiceNumber}`;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="border-b border-border p-5">
        <p className="text-sm text-muted-foreground">
          {link.memberName ? `Hi ${link.memberName}, pay` : "Pay"} {link.gymName}
        </p>
        <p className="mt-1 text-4xl font-black tracking-tight tabular-nums">
          {formatPrice(link.amount)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{what}</p>
      </header>
      <div className="grid gap-5 p-5">
        {link.status === "open" && link.on && link.uri ? (
          <OpenLink token={token} link={link} onChange={onChange} />
        ) : link.status === "open" ? (
          <Notice tone="muted" title="Online payment is off">
            Please pay at the gym.
          </Notice>
        ) : link.status === "member_paid" ? (
          <Notice tone="wait" title="Thanks! The gym will confirm it">
            You said you paid {formatPrice(link.amount)} by UPI
            {link.utr ? ` (reference ${link.utr})` : ""}. Once the gym finds it in their account, it
            shows as received in your app and on your bill.
          </Notice>
        ) : link.status === "confirmed" ? (
          <Notice tone="done" title="Payment received">
            The gym has confirmed your payment. Thank you!
          </Notice>
        ) : (
          <Notice tone="muted" title="This link is closed">
            {link.closedText}
          </Notice>
        )}
        {link.billToken ? (
          <a
            href={`/invoice/${link.billToken}`}
            className="text-center text-sm font-semibold underline underline-offset-2"
          >
            Open the bill
          </a>
        ) : null}
      </div>
    </section>
  );
}

function OpenLink({
  token,
  link,
  onChange,
}: {
  token: string;
  link: PublicPayLink;
  onChange: (l: PublicPayLink) => void;
}) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [utr, setUtr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const paid = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = cleanUtr(utr);
    if ("error" in c) return setError(c.error);
    setBusy(true);
    setError("");
    try {
      onChange(await call(token, { action: "paid", utr: c.utr }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {link.deskNote ? (
        <Notice tone="warn" title="Message from the gym">
          {link.deskNote}
        </Notice>
      ) : null}
      <Button asChild size="lg" className="h-12 w-full text-base">
        <a href={link.uri}>
          <Smartphone aria-hidden /> Pay with a UPI app
        </a>
      </Button>
      <div className="grid justify-items-center gap-2">
        <UpiQr
          uri={link.uri}
          label={`UPI QR code to pay ${formatPrice(link.amount)} to ${link.payeeName}`}
          className="size-52 border border-border"
        />
        <p className="max-w-64 text-center text-xs text-muted-foreground">
          Or scan this from another phone, or save a screenshot and pick it in your UPI app.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted p-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">UPI ID · {link.payeeName}</p>
          <p className="truncate font-mono text-sm font-semibold" data-testid="pay-upi-id">
            {link.upiId}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void copy()} aria-live="polite">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <form onSubmit={(e) => void paid(e)} className="grid gap-3 border-t border-border pt-5">
        <div className="grid gap-1.5">
          <p className="text-sm font-semibold">Paid? Tell the gym</p>
          <label htmlFor={`${id}-utr`} className="text-label">
            UPI reference (optional)
          </label>
          <Input
            id={`${id}-utr`}
            value={utr}
            inputMode="text"
            autoComplete="off"
            maxLength={40}
            onChange={(e) => setUtr(e.target.value)}
            placeholder="12-digit number"
            aria-invalid={!!error}
            aria-describedby={`${id}-utr-hint`}
          />
          <p id={`${id}-utr-hint`} className="text-xs text-muted-foreground">
            It's in your UPI app's payment details (UTR / UPI Ref No.). It helps the gym find your
            payment quickly.
          </p>
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" disabled={busy} className="w-full">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          I've paid {formatPrice(link.amount)}
        </Button>
      </form>
    </>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "muted" | "wait" | "done" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "done" ? CircleCheck : tone === "wait" ? Clock : MessageSquareWarning;
  return (
    <div
      role="status"
      className={cn(
        "flex gap-3 rounded-xl border p-4 text-sm",
        tone === "done" && "border-success/30 bg-success/10",
        tone === "wait" && "border-primary/30 bg-primary/5",
        tone === "warn" && "border-warning/40 bg-warning/10",
        tone === "muted" && "border-border bg-muted/50",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          tone === "done" && "text-success",
          tone === "wait" && "text-primary",
          tone === "warn" && "text-warning",
          tone === "muted" && "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="grid gap-1">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
