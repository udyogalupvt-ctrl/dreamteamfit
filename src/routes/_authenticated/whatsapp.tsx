import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { z } from "zod";
import { ChatList } from "@/components/whatsapp/chat-list";
import { ChatThread } from "@/components/whatsapp/chat-thread";
import { useLive } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";
import { subscribeClient } from "@/services/clients.service";
import type { Client } from "@/types/models";
import {
  chatSetupStatus,
  subscribeChat,
  subscribeChats,
  type WaChat,
} from "@/services/whatsapp-chats.service";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  validateSearch: z.object({
    chat: z
      .string()
      .regex(/^\d{8,15}$/)
      .optional(),
  }),
  head: () => ({ meta: [{ title: "WhatsApp — REBUILD FITNESS" }] }),
  component: WhatsAppPage,
});

const PAGE = 40;
type Setup = Awaited<ReturnType<typeof chatSetupStatus>>;

function WhatsAppPage() {
  const { chat: selected = "" } = Route.useSearch();
  const navigate = useNavigate({ from: "/whatsapp" });
  const [max, setMax] = useState(PAGE);
  const chats = useLive<WaChat[]>((ok, fail) => subscribeChats(max, ok, fail), [], [max]);
  // The open chat on its own, so a chat opened from a member's page works even when it is not
  // among the latest chats (or has no messages yet).
  const open = useLive<WaChat | null>(
    selected ? (ok, fail) => subscribeChat(selected, ok, fail) : null,
    null,
    [selected],
  );
  // The member as they are now (photo / name changed since their last message).
  const clientId = open.data?.clientId ?? "";
  const member = useLive<Client | null>(
    clientId ? (ok, fail) => subscribeClient(clientId, ok, fail) : null,
    null,
    [clientId],
  );
  const openChat =
    open.data && member.data
      ? {
          ...open.data,
          clientName: member.data.fullName,
          clientPhotoUrl: member.data.profilePhotoUrl,
          clientCode: member.data.clientCode,
        }
      : open.data;
  const [setup, setSetup] = useState<Setup | null>(null);
  useEffect(() => {
    chatSetupStatus()
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);

  const select = (waId: string) => navigate({ search: { chat: waId } });
  const back = () => navigate({ search: {} });

  const banner =
    setup && (!setup.connected || setup.webhook !== "ok") ? (
      <div
        role="status"
        className="mx-3 mb-2 flex gap-2.5 rounded-lg bg-[var(--wa-notice)] p-3 text-[13px] leading-[18px] text-[var(--wa-notice-text)]"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          {!setup.connected
            ? "WhatsApp Cloud API is not connected on the server, so messages can't be received or sent."
            : !setup.appSecret
              ? "Members' messages can't reach the app yet: add WHATSAPP_APP_SECRET (Meta → App settings → Basic → App secret) on Vercel, then Redeploy."
              : setup.webhook === "refused"
                ? "Meta's messages are being refused: the App secret on Vercel doesn't match Meta's. Copy it again into WHATSAPP_APP_SECRET, then Redeploy."
                : "No message has reached the app yet. In Meta → WhatsApp → Configuration, the webhook must be this app's /api/whatsapp/webhook with the “messages” field subscribed."}
        </p>
      </div>
    ) : null;

  return (
    <div className="wa-theme -mx-4 -mt-5 sm:-mx-6 lg:mx-0 lg:mt-0">
      <h1 className="sr-only">WhatsApp chats</h1>
      <div className="overflow-hidden bg-[var(--wa-panel)] lg:grid lg:h-[calc(100dvh-7.75rem)] lg:min-h-[520px] lg:grid-cols-[minmax(320px,30%)_1fr] lg:rounded-xl lg:border lg:border-[var(--wa-divider)] lg:shadow-sm">
        <aside
          className={cn(
            "flex min-h-0 flex-col lg:border-r lg:border-[var(--wa-divider)]",
            selected && "hidden lg:flex",
          )}
        >
          <div className="flex h-[60px] shrink-0 items-center px-4 lg:bg-[var(--wa-header)]">
            <p className="text-[22px] font-bold text-[var(--wa-green)] lg:text-lg lg:font-semibold lg:text-[var(--wa-text)]">
              Chats
            </p>
          </div>
          <ChatList
            chats={chats.data}
            loading={chats.loading}
            selected={selected}
            onSelect={select}
            canLoadMore={chats.data.length >= max}
            onLoadMore={() => setMax((m) => m + PAGE)}
            banner={banner}
          />
        </aside>
        {selected ? (
          // Phone: the chat covers the whole screen, like the WhatsApp app (Back returns).
          <div className="fixed inset-0 z-50 lg:static lg:z-auto lg:min-h-0">
            <ChatThread
              waId={selected}
              chat={openChat}
              onBack={back}
              canSend={setup ? setup.connected : true}
            />
          </div>
        ) : (
          <div className="hidden min-h-0 flex-col items-center justify-center gap-4 border-b-[6px] border-[var(--wa-accent)] bg-[var(--wa-header)] px-10 text-center lg:flex">
            <span className="grid size-20 place-items-center rounded-full bg-[var(--wa-panel)] text-[var(--wa-accent)]">
              <MessagesSquare className="size-10" aria-hidden />
            </span>
            <h2 className="text-[28px] font-light text-[var(--wa-text)]">WhatsApp chats</h2>
            <p className="max-w-md text-sm leading-5 text-[var(--wa-muted)]">
              Messages members send to the gym's WhatsApp number appear here. Reply within 24 hours
              of their last message; replies go from the gym's number.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
