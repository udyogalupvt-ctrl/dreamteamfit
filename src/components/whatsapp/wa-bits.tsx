import { Check, CheckCheck, CircleAlert, Clock3, User } from "lucide-react";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { cn } from "@/lib/utils";
import { prettyWaNumber, type WaChat } from "@/services/whatsapp-chats.service";

const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long" });
const shortDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
});
const longDate = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "10:42 am", as WhatsApp shows it in India. */
export const timeLabel = (d: Date) => time.format(d).toLowerCase();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (d: Date, now = new Date()) =>
  Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

/** Chat list: time today, "Yesterday", the weekday this week, else the date. */
export function listTime(d: Date | null) {
  if (!d) return "";
  const n = daysAgo(d);
  if (n <= 0) return timeLabel(d);
  if (n === 1) return "Yesterday";
  if (n < 7) return weekday.format(d);
  return shortDate.format(d);
}

/** The chip between days in a chat: "Today", "Yesterday", "Monday", "8 October 2026". */
export function dayLabel(d: Date) {
  const n = daysAgo(d);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 7) return weekday.format(d);
  return longDate.format(d);
}

export const sameDay = (a: Date, b: Date) => startOfDay(a) === startOfDay(b);

/** Sent ✓, delivered ✓✓, read (blue) ✓✓, waiting 🕓, failed (!). */
export function Ticks({ status, className }: { status: string; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  if (status === "pending") return <Clock3 className={cn(c, "size-3.5")} aria-label="Sending" />;
  if (status === "failed")
    return <CircleAlert className={cn(c, "text-[#ea0038]")} aria-label="Not sent" />;
  if (status === "read")
    return <CheckCheck className={cn(c, "text-[var(--wa-tick-read)]")} aria-label="Read" />;
  if (status === "delivered") return <CheckCheck className={c} aria-label="Delivered" />;
  return <Check className={c} aria-label="Sent" />;
}

/** The name staff know them by: the member, else their WhatsApp name, else the number. */
export const chatTitle = (c: Pick<WaChat, "clientName" | "profileName" | "waId">) =>
  c.clientName || c.profileName || prettyWaNumber(c.waId);

/** Member photo / initials; anyone else gets WhatsApp's grey person. */
export function ChatAvatar({
  chat,
  size = 49,
  zoomable = false,
}: {
  chat: Pick<WaChat, "clientName" | "clientPhotoUrl" | "profileName" | "waId">;
  size?: number;
  zoomable?: boolean;
}) {
  if (chat.clientName)
    return (
      <ClientAvatar
        name={chat.clientName}
        url={chat.clientPhotoUrl}
        size={size}
        zoomable={zoomable}
        className="ring-0"
      />
    );
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#dfe5e7] text-white dark:bg-[#6a7175] dark:text-[#cfd4d6]"
      style={{ width: size, height: size }}
    >
      <User
        className="translate-y-[12%]"
        style={{ width: size * 0.72, height: size * 0.72 }}
        fill="currentColor"
        strokeWidth={0}
      />
    </span>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

/** Message text with web links made clickable (only http/https, opened in a new tab). */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-[#027eb5] underline-offset-2 hover:underline dark:text-[#53bdeb]"
          >
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
