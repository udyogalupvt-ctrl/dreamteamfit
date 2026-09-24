import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLive } from "@/hooks/use-live-query";
import { formatDate } from "@/lib/format";
import { subscribeWhatsAppMessages } from "@/services/whatsapp.service";
import type { StatTone } from "@/types";
import type { WhatsAppMessage } from "@/types/models";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Message history — REBUILD FITNESS" }] }),
  component: MessageHistoryPage,
});

/** What each message was, in the words staff use. */
const KIND: Record<string, string> = {
  invoice: "Bill",
  payment_due: "Payment reminder",
  renewal: "Renewal reminder",
  birthday: "Birthday wish",
  absence: "Missed-you message",
  announcement: "Announcement",
  follow_up: "Message",
  test: "Test",
};
const STATUS: Record<string, { label: string; tone: StatTone }> = {
  queued: { label: "Sending", tone: "warning" },
  sent: { label: "Sent", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  read: { label: "Read", tone: "success" },
  failed: { label: "Not sent", tone: "danger" },
};
const PAGE = 100;
const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/** Every WhatsApp message the gym sent (bills, reminders, wishes, announcements) and whether it went. */
function MessageHistoryPage() {
  const messages = useLive<WhatsAppMessage[]>(subscribeWhatsAppMessages, [], []);
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.data.filter(
      (m) =>
        (kind === "all" || m.type === kind) &&
        (status === "all" ||
          (status === "sent"
            ? ["sent", "delivered", "read"].includes(m.status)
            : m.status === status)) &&
        (!q ||
          `${m.clientNameSnapshot} ${m.phoneSnapshot} ${m.messagePreview}`
            .toLowerCase()
            .includes(q)),
    );
  }, [messages.data, kind, status, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Message history"
        description="Every WhatsApp message the gym sent: bills, reminders, birthday wishes and announcements, and whether it went out."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Message history" }]}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search name, phone or message…"
          label="Search messages"
        />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger aria-label="Message type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All messages</SelectItem>
            {Object.entries(KIND).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Message status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sent or not</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="failed">Not sent</SelectItem>
            <SelectItem value="queued">Sending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {messages.error ? (
        <ErrorState error={messages.error} title="Couldn't load messages" />
      ) : messages.loading ? (
        <LoadingRows rows={4} />
      ) : !rows.length ? (
        <EmptyState
          icon={MessageCircle}
          title={messages.data.length ? "No messages match" : "No WhatsApp messages yet"}
          description={
            messages.data.length
              ? "Try another name or filter."
              : "Bills, reminders, birthday wishes and announcements appear here once they are sent."
          }
        />
      ) : (
        <>
          <p className="text-meta">
            {rows.length} message{rows.length === 1 ? "" : "s"}
          </p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {rows.slice(0, shown).map((m) => {
              const st = STATUS[m.status] ?? { label: m.status, tone: "info" as const };
              return (
                <li key={m.id} className="surface-card space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold">
                        {m.clientNameSnapshot || m.phoneSnapshot || m.normalizedPhone}
                      </p>
                      <p className="text-meta">
                        {KIND[m.type] ?? m.type} · {formatDate(m.createdAt)}{" "}
                        {time.format(m.createdAt)} · {m.phoneSnapshot || m.normalizedPhone}
                      </p>
                    </div>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                  </div>
                  {m.messagePreview ? (
                    <p className="line-clamp-3 whitespace-pre-line text-sm">{m.messagePreview}</p>
                  ) : null}
                  {m.status === "failed" && m.errorMessage ? (
                    <p className="text-sm text-destructive">Why: {m.errorMessage}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {rows.length > shown ? (
            <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
