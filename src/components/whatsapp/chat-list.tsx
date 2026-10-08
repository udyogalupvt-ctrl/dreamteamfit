import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { prettyWaNumber, type WaChat } from "@/services/whatsapp-chats.service";
import { ChatAvatar, chatTitle, listTime, Ticks } from "./wa-bits";

type Filter = "all" | "unread" | "members";

export function ChatList({
  chats,
  loading,
  selected,
  onSelect,
  canLoadMore,
  onLoadMore,
  banner,
}: {
  chats: WaChat[];
  loading: boolean;
  selected: string;
  onSelect: (waId: string) => void;
  canLoadMore: boolean;
  onLoadMore: () => void;
  banner?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return chats.filter((c) => {
      if (filter === "unread" && !c.unread) return false;
      if (filter === "members" && !c.clientId) return false;
      if (!needle) return true;
      return (
        chatTitle(c).toLowerCase().includes(needle) ||
        c.profileName.toLowerCase().includes(needle) ||
        (digits.length >= 3 && c.waId.includes(digits)) ||
        (!!c.clientCode && c.clientCode === needle)
      );
    });
  }, [chats, q, filter]);
  const unreadChats = chats.filter((c) => c.unread > 0).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wa-panel)]">
      <div className="space-y-2.5 px-3 pt-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-[var(--wa-icon)]"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or number"
            className="h-10 w-full rounded-lg bg-[var(--wa-search)] pr-9 pl-11 text-[15px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-muted)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)] [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[var(--wa-icon)] hover:bg-[var(--wa-hover)]"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </label>
        <div role="tablist" aria-label="Show" className="flex gap-2 overflow-x-auto no-scrollbar">
          {(
            [
              ["all", "All"],
              ["unread", unreadChats ? `Unread ${unreadChats}` : "Unread"],
              ["members", "Members"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={cn(
                "h-8 shrink-0 cursor-pointer rounded-full px-3.5 text-sm transition-colors",
                filter === k
                  ? "bg-[#d9fdd3] font-medium text-[#008069] dark:bg-[#0a332c] dark:text-[#25d366]"
                  : "bg-[var(--wa-search)] text-[var(--wa-muted)] hover:bg-[var(--wa-selected)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {banner}
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Chats">
        {loading && !chats.length
          ? Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3" aria-hidden>
                <span className="size-[49px] shrink-0 animate-pulse rounded-full bg-[var(--wa-search)]" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3.5 w-2/5 animate-pulse rounded bg-[var(--wa-search)]" />
                  <span className="block h-3 w-3/4 animate-pulse rounded bg-[var(--wa-search)]" />
                </span>
              </li>
            ))
          : null}
        {shown.map((c) => (
          <li key={c.id}>
            <ChatRow chat={c} active={c.waId === selected} onSelect={onSelect} />
          </li>
        ))}
        {!loading && !shown.length ? (
          <li className="px-8 py-12 text-center text-sm text-[var(--wa-muted)]">
            {chats.length
              ? filter === "unread"
                ? "No unread chats."
                : "No chats match."
              : "No chats yet. When a member messages the gym's WhatsApp number, the chat appears here."}
          </li>
        ) : null}
        {canLoadMore && !q && filter === "all" ? (
          <li className="px-3 py-3 text-center">
            <button
              type="button"
              onClick={onLoadMore}
              className="h-9 cursor-pointer rounded-full px-4 text-sm font-medium text-[var(--wa-green)] hover:bg-[var(--wa-hover)]"
            >
              Load older chats
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function ChatRow({
  chat,
  active,
  onSelect,
}: {
  chat: WaChat;
  active: boolean;
  onSelect: (waId: string) => void;
}) {
  const unread = chat.unread > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(chat.waId)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 pl-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-accent)]",
        active ? "bg-[var(--wa-selected)]" : "hover:bg-[var(--wa-hover)]",
      )}
    >
      <ChatAvatar chat={chat} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 border-b border-[var(--wa-divider)] py-3 pr-3 group-last:border-b-0">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[17px] leading-[21px] text-[var(--wa-text)]">
            {chatTitle(chat)}
          </span>
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              unread ? "font-medium text-[var(--wa-green)]" : "text-[var(--wa-muted)]",
            )}
          >
            {listTime(chat.lastMessageAt)}
          </span>
        </span>
        <span className="flex items-center gap-1 text-sm leading-5 text-[var(--wa-muted)]">
          {chat.lastDirection === "out" && chat.lastStatus ? (
            <Ticks status={chat.lastStatus} className="text-[var(--wa-muted)]" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            {chat.lastText || (chat.clientName ? prettyWaNumber(chat.waId) : "")}
          </span>
          {unread ? (
            <span
              className="ml-1 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--wa-badge)] px-1.5 text-xs font-semibold text-[var(--wa-badge-text)] tabular-nums"
              aria-label={`${chat.unread} unread`}
            >
              {chat.unread > 99 ? "99+" : chat.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
