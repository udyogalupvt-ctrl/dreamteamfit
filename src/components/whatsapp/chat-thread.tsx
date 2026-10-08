import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileText,
  Lock,
  MapPin,
  Play,
  Reply,
  SendHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoViewer } from "@/components/clients/client-avatar";
import { useLive } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";
import {
  chatMediaUrl,
  markChatRead,
  prettyWaNumber,
  replyToChat,
  replyWindowOpen,
  subscribeMessages,
  type WaChat,
  type WaMessage,
} from "@/services/whatsapp-chats.service";
import { ChatAvatar, chatTitle, dayLabel, Linkified, sameDay, Ticks, timeLabel } from "./wa-bits";

const PAGE = 50;

type Pending = { tempId: string; text: string; at: Date; replyTo: string; failed?: string };

export function ChatThread({
  waId,
  chat,
  onBack,
  canSend,
}: {
  waId: string;
  /** null = nobody has written yet (opened from a member's page). */
  chat: WaChat | null;
  onBack: () => void;
  canSend: boolean;
}) {
  const [max, setMax] = useState(PAGE);
  const live = useLive<WaMessage[]>(
    (ok, fail) => subscribeMessages(waId, max, ok, fail),
    [],
    [waId, max],
  );
  const messages = live.data;
  const [pending, setPending] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<WaMessage | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // A new chat starts at its newest message.
  useEffect(() => {
    setMax(PAGE);
    setPending([]);
    setReplyTo(null);
    atBottom.current = true;
  }, [waId]);

  // Sent replies show at once (🕓) and are swapped for the real message when it arrives.
  useEffect(() => {
    setPending((p) => p.filter((x) => x.failed || !messages.some((m) => m.id === x.tempId)));
  }, [messages]);

  const scrollToEnd = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior:
        smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "smooth"
          : "auto",
    });
  }, []);

  // Keep the newest message in view unless staff scrolled up to read older ones.
  const lastKey = `${messages.at(-1)?.id ?? ""}|${pending.length}`;
  useLayoutEffect(() => {
    if (atBottom.current) scrollToEnd();
  }, [lastKey, waId, scrollToEnd]);

  // Older messages loaded at the top: keep the same message under the eye.
  const heightBefore = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !heightBefore.current) return;
    el.scrollTop += el.scrollHeight - heightBefore.current;
    heightBefore.current = 0;
  }, [messages.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = fromBottom < 80;
    setShowJump(fromBottom > 300);
    if (el.scrollTop < 120 && messages.length >= max && !live.loading) {
      heightBefore.current = el.scrollHeight;
      setMax((m) => m + PAGE);
    }
  };

  // Opened = read: unread goes to 0 and the member sees blue ticks.
  const unread = chat?.unread ?? 0;
  useEffect(() => {
    if (!unread || !canSend) return;
    if (document.visibilityState !== "visible") return;
    markChatRead(waId).catch(() => undefined);
  }, [waId, unread, canSend]);

  const send = async (text: string) => {
    const tempId = `tmp-${Date.now()}`;
    const quote = replyTo?.id ?? "";
    setReplyTo(null);
    atBottom.current = true;
    setPending((p) => [...p, { tempId, text, at: new Date(), replyTo: quote }]);
    try {
      const r = await replyToChat(waId, text, quote || undefined);
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, tempId: r.id } : x)));
    } catch (e) {
      const msg = (e as Error).message;
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: msg } : x)));
      toast.error(msg);
    }
  };

  const windowOpen = chat ? replyWindowOpen(chat) : false;
  const title = chat ? chatTitle(chat) : prettyWaNumber(waId);
  const all: (WaMessage | (Pending & { pending: true }))[] = [
    ...messages,
    ...pending.map((p) => ({ ...p, pending: true as const })),
  ];

  return (
    <section
      aria-label={`Chat with ${title}`}
      className="relative flex h-full min-h-0 flex-col bg-[var(--wa-app)]"
    >
      <header className="flex h-[60px] shrink-0 items-center gap-2 bg-[var(--wa-header)] px-2 pt-[env(safe-area-inset-top)] lg:gap-3 lg:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chats"
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--wa-icon)] hover:bg-black/5 lg:hidden dark:hover:bg-white/10"
        >
          <ArrowLeft className="size-6" aria-hidden />
        </button>
        <ChatAvatar
          chat={chat ?? { clientName: "", clientPhotoUrl: null, profileName: "", waId }}
          size={40}
          zoomable
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base leading-5 text-[var(--wa-text)]">{title}</h2>
          <p className="truncate text-[13px] leading-4 text-[var(--wa-muted)]">
            {chat?.clientName
              ? `${chat.clientCode ? `Member ${chat.clientCode} · ` : ""}${prettyWaNumber(waId)}`
              : chat?.profileName
                ? `${prettyWaNumber(waId)} · not a member`
                : "not a member"}
          </p>
        </div>
        {chat?.clientId ? (
          <Link
            to="/clients/$clientId"
            params={{ clientId: chat.clientId }}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[var(--wa-icon)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            <UserRound className="size-5" aria-hidden />
            <span className="hidden sm:inline">Open member</span>
            <span className="sr-only sm:hidden">Open member</span>
          </Link>
        ) : null}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="wa-wallpaper relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-[3%] pb-2 lg:px-[6%]"
        role="log"
        aria-live="polite"
        aria-label="Messages"
      >
        <div className="mx-auto flex max-w-[1100px] flex-col pt-2">
          {messages.length >= max ? (
            <p className="py-2 text-center text-xs text-[var(--wa-chip-text)]">
              Loading older messages…
            </p>
          ) : (
            <p className="mx-auto my-2 flex max-w-md items-start gap-1.5 rounded-lg bg-[var(--wa-notice)] px-3 py-1.5 text-center text-[12.5px] leading-[18px] text-[var(--wa-notice-text)] shadow-[var(--wa-shadow)]">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                Messages to and from the gym's WhatsApp Business number. Only staff with WhatsApp
                chats switched on can see them.
              </span>
            </p>
          )}
          {!live.loading && !all.length ? (
            <p className="mx-auto my-6 rounded-lg bg-[var(--wa-chip)] px-3 py-1.5 text-center text-[12.5px] text-[var(--wa-chip-text)] shadow-[var(--wa-shadow)]">
              No messages yet.
            </p>
          ) : null}
          {all.map((m, i) => {
            const prev = all[i - 1];
            const newDay = !prev || !sameDay(prev.at, m.at);
            const dir = "pending" in m ? "out" : m.direction;
            const prevDir = prev ? ("pending" in prev ? "out" : prev.direction) : null;
            const first = newDay || prevDir !== dir;
            return (
              <div key={"pending" in m ? m.tempId : m.id} className="contents">
                {newDay ? (
                  <div className="sticky top-1.5 z-10 my-2 flex justify-center">
                    <span className="rounded-lg bg-[var(--wa-chip)] px-3 py-1.5 text-[12.5px] text-[var(--wa-chip-text)] uppercase shadow-[var(--wa-shadow)]">
                      {dayLabel(m.at)}
                    </span>
                  </div>
                ) : null}
                {"pending" in m ? (
                  <Bubble
                    dir="out"
                    first={first}
                    at={m.at}
                    status={m.failed ? "failed" : "pending"}
                    quote={m.replyTo ? byId.get(m.replyTo) : undefined}
                    hasQuote={!!m.replyTo}
                    error={m.failed}
                  >
                    <TextBody text={m.text} />
                  </Bubble>
                ) : (
                  <MessageRow
                    m={m}
                    first={first}
                    waId={waId}
                    quote={m.replyTo ? byId.get(m.replyTo) : undefined}
                    onReply={windowOpen && canSend ? () => setReplyTo(m) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showJump ? (
        <button
          type="button"
          onClick={() => {
            atBottom.current = true;
            scrollToEnd(true);
          }}
          aria-label="Go to the newest message"
          className="absolute right-4 bottom-[84px] z-20 grid size-11 cursor-pointer place-items-center rounded-full bg-[var(--wa-panel)] text-[var(--wa-icon)] shadow-md"
        >
          <ChevronDown className="size-6" aria-hidden />
        </button>
      ) : null}

      <Composer
        key={waId}
        open={windowOpen && canSend}
        reason={
          !canSend
            ? "WhatsApp Cloud API is not connected, so replies can't be sent."
            : chat
              ? "WhatsApp allows replies only within 24 hours of the member's last message. After that, only the app's approved messages (bills, reminders, announcements) can be sent."
              : "This member hasn't messaged the gym's WhatsApp number yet. You can reply once they do."
        }
        replyTo={replyTo}
        replyToName={replyTo?.direction === "out" ? "You" : title}
        onCancelReply={() => setReplyTo(null)}
        onSend={send}
      />
    </section>
  );
}

function MessageRow({
  m,
  first,
  waId,
  quote,
  onReply,
}: {
  m: WaMessage;
  first: boolean;
  waId: string;
  quote: WaMessage | undefined;
  onReply?: (() => void) | undefined;
}) {
  if (m.type === "sticker" && m.media)
    return (
      <Row dir={m.direction} first={first} onReply={onReply}>
        <div className="relative">
          <MediaImage waId={waId} m={m} sticker />
          <span className="mt-0.5 block text-right text-[11px] text-[var(--wa-chip-text)]">
            {timeLabel(m.at)}
          </span>
        </div>
      </Row>
    );
  return (
    <Row dir={m.direction} first={first} onReply={onReply}>
      <Bubble
        dir={m.direction}
        first={first}
        at={m.at}
        status={m.direction === "out" ? m.status : ""}
        by={first && m.direction === "out" ? (m.template ? "Sent by the app" : m.by) : ""}
        quote={quote}
        hasQuote={!!m.replyTo}
        reaction={m.reaction}
        error={m.status === "failed" ? m.error || "Not delivered" : ""}
        wide={m.type === "image"}
        overlayTime={m.type === "image" && !m.caption}
      >
        <MessageBody m={m} waId={waId} />
      </Bubble>
    </Row>
  );
}

/** A message line: swipe right on a phone (or the hover button on a computer) to reply. */
function Row({
  dir,
  first,
  onReply,
  children,
}: {
  dir: "in" | "out";
  first: boolean;
  onReply?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return (
    <div
      className={cn(
        "group/row relative flex touch-pan-y",
        dir === "out" ? "justify-end" : "justify-start",
        first ? "mt-2.5" : "mt-0.5",
      )}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch" || !onReply) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const x = e.clientX - s.x;
        if (Math.abs(e.clientY - s.y) > 30) {
          start.current = null;
          setDx(0);
          return;
        }
        setDx(Math.max(0, Math.min(72, x)));
      }}
      onPointerUp={() => {
        if (start.current && dx > 56) onReply?.();
        start.current = null;
        setDx(0);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
    >
      {dx > 8 ? (
        <span
          aria-hidden
          className="absolute top-1/2 -left-9 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-[var(--wa-chip)] text-[var(--wa-icon)]"
          style={{ opacity: Math.min(1, dx / 56) }}
        >
          <Reply className="size-4" />
        </span>
      ) : null}
      {onReply && dir === "out" ? <ReplyButton onReply={onReply} /> : null}
      {children}
      {onReply && dir === "in" ? <ReplyButton onReply={onReply} /> : null}
    </div>
  );
}

function ReplyButton({ onReply }: { onReply: () => void }) {
  return (
    <button
      type="button"
      onClick={onReply}
      aria-label="Reply to this message"
      className="mx-1 hidden size-8 shrink-0 cursor-pointer place-items-center self-center rounded-full bg-[var(--wa-chip)]/90 text-[var(--wa-icon)] opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 sm:grid"
    >
      <Reply className="size-4" aria-hidden />
    </button>
  );
}

function Bubble({
  dir,
  first,
  at,
  status,
  by,
  quote,
  hasQuote,
  reaction,
  error,
  wide,
  overlayTime,
  children,
}: {
  dir: "in" | "out";
  first: boolean;
  at: Date;
  status: string;
  by?: string;
  quote?: WaMessage | undefined;
  hasQuote?: boolean;
  reaction?: string;
  error?: string | undefined;
  wide?: boolean;
  /** A photo with no caption: the time sits on the photo. */
  overlayTime?: boolean;
  children: React.ReactNode;
}) {
  const out = dir === "out";
  return (
    <div
      className={cn(
        "relative max-w-[85%] rounded-lg px-[7px] pt-1.5 pb-2 text-[14.2px] leading-[19px] text-[var(--wa-text)] shadow-[var(--wa-shadow)] sm:max-w-[65%]",
        out ? "bg-[var(--wa-out)]" : "bg-[var(--wa-in)]",
        first && (out ? "rounded-tr-none" : "rounded-tl-none"),
        wide && "p-1",
        reaction && "mb-3",
      )}
    >
      {first ? <Tail out={out} /> : null}
      {by ? (
        <p
          className={cn(
            "px-0.5 pb-0.5 text-[12.8px] font-medium text-[#1f7aec] dark:text-[#53bdeb]",
            wide && "px-1.5 pt-0.5",
          )}
        >
          {by}
        </p>
      ) : null}
      {hasQuote ? <Quote m={quote} out={out} /> : null}
      <div className={cn("px-0.5", wide && "px-0")}>
        {children}
        {/* Room for the time, so it never sits on top of the last word. */}
        {overlayTime ? null : <span aria-hidden className="inline-block w-[74px]" />}
      </div>
      <span
        className={cn(
          "absolute right-2 bottom-1 flex items-center gap-1 text-[11px] leading-[15px] whitespace-nowrap tabular-nums",
          out ? "text-[var(--wa-meta-out)]" : "text-[var(--wa-meta)]",
          overlayTime && "right-2.5 bottom-2.5 rounded-full bg-black/40 px-1.5 text-white",
        )}
      >
        {timeLabel(at)}
        {out && status ? <Ticks status={status} /> : null}
      </span>
      {error ? (
        <p className="mt-1 px-0.5 text-xs text-[#ea0038] dark:text-[#f15c6d]">{error}</p>
      ) : null}
      {reaction ? (
        <span
          className={cn(
            "absolute -bottom-3.5 grid h-6 min-w-7 place-items-center rounded-full border-2 border-[var(--wa-wall)] bg-[var(--wa-chip)] px-1 text-sm shadow-sm",
            out ? "right-2" : "left-2",
          )}
          aria-label={`Reaction ${reaction}`}
        >
          {reaction}
        </span>
      ) : null}
    </div>
  );
}

/** WhatsApp's little corner on the first bubble of a run. */
function Tail({ out }: { out: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={cn(
        "absolute top-0",
        out ? "-right-2 text-[var(--wa-out)]" : "-left-2 -scale-x-100 text-[var(--wa-in)]",
      )}
    >
      <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
    </svg>
  );
}

function Quote({ m, out }: { m: WaMessage | undefined; out: boolean }) {
  return (
    <div
      className={cn(
        "mb-1 flex overflow-hidden rounded-md text-[13px]",
        out ? "bg-[var(--wa-quote-out)]" : "bg-[var(--wa-quote-in)]",
      )}
    >
      <span className="w-1 shrink-0 bg-[#06cf9c]" aria-hidden />
      <span className="min-w-0 px-2 py-1">
        <span className="block font-medium text-[#06a47e] dark:text-[#06cf9c]">
          {m ? (m.direction === "out" ? "You" : "Member") : "Message"}
        </span>
        <span className="line-clamp-2 text-[var(--wa-muted)]">
          {m ? quoteText(m) : "Earlier message"}
        </span>
      </span>
    </div>
  );
}

const quoteText = (m: WaMessage) =>
  m.text ||
  m.caption ||
  (
    {
      image: "📷 Photo",
      video: "🎥 Video",
      audio: "🎤 Voice message",
      document: `📄 ${m.filename || "Document"}`,
      location: "📍 Location",
      sticker: "Sticker",
    } as Record<string, string>
  )[m.type] ||
  "Message";

function TextBody({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      <Linkified text={text} />
    </span>
  );
}

function MessageBody({ m, waId }: { m: WaMessage; waId: string }) {
  switch (m.type) {
    case "image":
      return (
        <>
          <MediaImage waId={waId} m={m} />
          {m.caption ? (
            <div className="px-1.5 pt-1">
              <TextBody text={m.caption} />
            </div>
          ) : null}
        </>
      );
    case "audio":
    case "video":
      return <MediaPlayer waId={waId} m={m} />;
    case "document":
      return <DocumentCard waId={waId} m={m} />;
    case "location":
      return m.location ? (
        <a
          href={`https://www.google.com/maps?q=${m.location.lat},${m.location.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 rounded-md bg-black/5 p-2 hover:bg-black/10 dark:bg-white/5"
        >
          <MapPin className="mt-0.5 size-5 shrink-0 text-[#ea0038]" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">{m.location.name || "Location"}</span>
            {m.location.address ? (
              <span className="block text-[13px] text-[var(--wa-muted)]">{m.location.address}</span>
            ) : null}
            <span className="block text-[13px] text-[#027eb5] dark:text-[#53bdeb]">
              Open in Google Maps
            </span>
          </span>
        </a>
      ) : null;
    case "contacts":
      return (
        <span className="flex items-center gap-2">
          <UserRound className="size-5 text-[var(--wa-icon)]" aria-hidden />
          <span>
            {m.contact?.name || "Contact"}
            {m.contact?.phone ? (
              <span className="block text-[13px] text-[var(--wa-muted)]">{m.contact.phone}</span>
            ) : null}
          </span>
        </span>
      );
    case "unsupported":
      return (
        <span className="text-[var(--wa-muted)] italic">
          This kind of message can't be shown here. Open WhatsApp on the gym phone to see it.
        </span>
      );
    default:
      return <TextBody text={m.text} />;
  }
}

/** Photos load through the server (WhatsApp keeps them 30 days). */
function useMedia(waId: string, id: string, auto: boolean) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    chatMediaUrl(waId, id)
      .then(setUrl)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [waId, id]);
  useEffect(() => {
    if (auto) load();
  }, [auto, load]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return { url, error, loading, load };
}

function MediaImage({
  waId,
  m,
  sticker = false,
}: {
  waId: string;
  m: WaMessage;
  sticker?: boolean;
}) {
  const { url, error, load } = useMedia(waId, m.id, true);
  const [open, setOpen] = useState(false);
  const size = sticker ? "size-32" : "w-[260px] max-w-full sm:w-[330px]";
  if (error)
    return (
      <button
        type="button"
        onClick={load}
        className={cn(
          size,
          "grid aspect-square cursor-pointer place-items-center rounded-md bg-black/10 p-4 text-center text-[13px] text-[var(--wa-muted)]",
        )}
      >
        Photo couldn't load. Tap to try again.
      </button>
    );
  if (!url)
    return (
      <span
        className={cn(
          size,
          "block aspect-square animate-pulse rounded-md bg-black/10 dark:bg-white/10",
        )}
        aria-label="Loading photo"
      />
    );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block cursor-zoom-in"
        aria-label="Open photo full screen"
      >
        <img
          src={url}
          alt={m.caption || (sticker ? "Sticker" : "Photo from the member")}
          className={cn(
            sticker
              ? "size-32 object-contain"
              : "max-h-[360px] w-[260px] max-w-full rounded-md object-cover sm:w-[330px]",
          )}
        />
      </button>
      {!sticker ? (
        <PhotoViewer
          open={open}
          onOpenChange={setOpen}
          src={url}
          title={m.caption || "Photo"}
          alt={m.caption || "Photo from the member"}
        />
      ) : null}
    </>
  );
}

function MediaPlayer({ waId, m }: { waId: string; m: WaMessage }) {
  const { url, error, loading, load } = useMedia(waId, m.id, false);
  const audio = m.type === "audio";
  if (url)
    return audio ? (
      <audio src={url} controls autoPlay className="h-10 w-[260px] max-w-full" />
    ) : (
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="max-h-[360px] w-[260px] max-w-full rounded-md sm:w-[330px]"
      />
    );
  return (
    <button
      type="button"
      onClick={load}
      disabled={loading}
      className="flex min-h-11 w-[230px] max-w-full cursor-pointer items-center gap-3 rounded-md px-1 text-left"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--wa-accent)] text-white">
        <Play className="size-5 translate-x-px" fill="currentColor" aria-hidden />
      </span>
      <span className="text-[13.5px]">
        {loading
          ? "Loading…"
          : error
            ? "Couldn't load. Tap to try again."
            : audio
              ? m.media?.voice
                ? "Voice message"
                : "Audio"
              : "Video"}
      </span>
    </button>
  );
}

function DocumentCard({ waId, m }: { waId: string; m: WaMessage }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const url = await chatMediaUrl(waId, m.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = m.filename || "document";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="flex w-[260px] max-w-full cursor-pointer items-center gap-3 rounded-md bg-black/5 p-2.5 text-left hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
      >
        <FileText className="size-8 shrink-0 text-[#7f66ff]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{m.filename || "Document"}</span>
          <span className="block text-xs text-[var(--wa-muted)] uppercase">
            {(m.media?.mime.split("/")[1] ?? "file").slice(0, 12)}
          </span>
        </span>
        <Download
          className={cn("size-5 shrink-0 text-[var(--wa-icon)]", busy && "animate-pulse")}
          aria-label="Download"
        />
      </button>
      {m.caption ? (
        <div className="pt-1">
          <TextBody text={m.caption} />
        </div>
      ) : null}
    </>
  );
}

function Composer({
  open,
  reason,
  replyTo,
  replyToName,
  onCancelReply,
  onSend,
}: {
  open: boolean;
  reason: string;
  replyTo: WaMessage | null;
  replyToName: string;
  onCancelReply: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Phones: Enter makes a new line (like WhatsApp); computers: Enter sends, Shift+Enter new line.
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    if (replyTo) box.current?.focus();
  }, [replyTo]);

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    requestAnimationFrame(() => {
      grow();
      box.current?.focus();
    });
  };

  if (!open)
    return (
      <footer className="shrink-0 bg-[var(--wa-header)] px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-[13px] leading-[18px] text-[var(--wa-muted)]">
        {reason}
      </footer>
    );

  return (
    <footer className="shrink-0 bg-[var(--wa-header)] px-2 py-[5px] pb-[max(env(safe-area-inset-bottom),5px)] lg:px-4">
      {replyTo ? (
        <div className="mb-1.5 flex items-stretch gap-2 rounded-lg bg-[var(--wa-panel)] p-1.5 pr-1">
          <span className="w-1 shrink-0 rounded-full bg-[#06cf9c]" aria-hidden />
          <div className="min-w-0 flex-1 py-0.5">
            <p className="text-[13px] font-medium text-[#06a47e] dark:text-[#06cf9c]">
              Replying to {replyToName}
            </p>
            <p className="truncate text-[13px] text-[var(--wa-muted)]">{quoteText(replyTo)}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="grid size-9 shrink-0 cursor-pointer place-items-center self-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message</span>
          <textarea
            ref={box}
            rows={1}
            value={text}
            maxLength={4096}
            enterKeyHint={coarse ? "enter" : "send"}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Type a message"
            className="block max-h-[140px] min-h-[42px] w-full resize-none rounded-[21px] bg-[var(--wa-input)] px-4 py-[10px] text-[15px] leading-[22px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-muted)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)] lg:rounded-lg"
          />
        </label>
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send"
          className="grid size-[42px] shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--wa-accent)] text-white transition-[transform,opacity] duration-150 active:scale-95 disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none"
        >
          <SendHorizontal className="size-5" aria-hidden />
        </button>
      </form>
    </footer>
  );
}
