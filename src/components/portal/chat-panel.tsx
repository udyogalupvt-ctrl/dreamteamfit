import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { Loader2, MessageCircle, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { indiaToday } from "@/constants/portal";
import { portalCall, portalDb } from "@/lib/portal-firebase";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatThread } from "@/types/models";
import { day } from "./portal-shell";

const time = (v: unknown) => (v as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? null;

export function mapThread(s: DocumentSnapshot<DocumentData>): ChatThread | null {
  const d = s.data({ serverTimestamps: "estimate" });
  if (!d) return null;
  return {
    clientId: s.id,
    clientName: String(d["clientName"] ?? ""),
    trainerId: String(d["trainerId"] ?? ""),
    trainerName: String(d["trainerName"] ?? ""),
    lastText: String(d["lastText"] ?? ""),
    lastFrom: d["lastFrom"] === "member" || d["lastFrom"] === "trainer" ? d["lastFrom"] : "",
    lastAt: time(d["lastAt"]),
    memberReadAt: time(d["memberReadAt"]),
    trainerReadAt: time(d["trainerReadAt"]),
  };
}

/** A new message from the other side that this person hasn't opened yet. */
export function isUnread(t: ChatThread | null, me: "member" | "trainer") {
  if (!t?.lastAt || !t.lastFrom || t.lastFrom === me) return false;
  const read = me === "member" ? t.memberReadAt : t.trainerReadAt;
  return !read || read.getTime() < t.lastAt.getTime();
}

/** Live chat between a member and their PT trainer (chats/{clientId}/messages). */
export function ChatPanel({
  clientId,
  me,
  myName,
  otherName,
  className,
}: {
  clientId: string;
  me: "member" | "trainer";
  myName: string;
  otherName: string;
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const threadRef = doc(portalDb, "chats", clientId);

  useEffect(
    () =>
      onSnapshot(
        query(collection(portalDb, "chats", clientId, "messages"), orderBy("at"), limitToLast(200)),
        (snap) =>
          setMessages(
            snap.docs.map((m) => {
              const d = m.data({ serverTimestamps: "estimate" });
              return {
                id: m.id,
                from: d["from"] === "trainer" ? "trainer" : "member",
                name: String(d["name"] ?? ""),
                text: String(d["text"] ?? ""),
                at: time(d["at"]) ?? new Date(),
              };
            }),
          ),
        () => setError("Chat is not open yet. It opens when your PT is active."),
      ),
    [clientId],
  );
  useEffect(
    () =>
      onSnapshot(
        doc(portalDb, "chats", clientId),
        (s) => setThread(mapThread(s)),
        () => undefined,
      ),
    [clientId],
  );
  // Opening the chat marks the other side's messages as read.
  useEffect(() => {
    if (!isUnread(thread, me)) return;
    void updateDoc(threadRef, {
      [me === "member" ? "memberReadAt" : "trainerReadAt"]: serverTimestamp(),
    }).catch(() => undefined);
  }, [thread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError("");
    try {
      const batch = writeBatch(portalDb);
      batch.set(doc(collection(portalDb, "chats", clientId, "messages")), {
        from: me,
        name: myName.slice(0, 80),
        text: t.slice(0, 2000),
        at: serverTimestamp(),
      });
      batch.update(threadRef, {
        lastText: t.slice(0, 140),
        lastFrom: me,
        lastAt: serverTimestamp(),
      });
      await batch.commit();
      setText("");
      // Tell the other side's phone (member app / trainer app notification). Best effort.
      void portalCall("/api/push/chat", { clientId }).catch(() => undefined);
    } catch {
      setError("Message not sent. Check your internet and try again.");
    } finally {
      setSending(false);
    }
  };

  let lastDay = "";
  return (
    <section
      className={cn("flex min-h-0 flex-col", className)}
      aria-label={`Chat with ${otherName}`}
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-3" aria-live="polite">
        {messages === null ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="animate-spin text-muted-foreground" aria-label="Loading chat" />
          </div>
        ) : !messages.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <MessageCircle className="mx-auto mb-2 size-8" aria-hidden />
            No messages yet. Say hi to {otherName}!
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.from === me;
            const d = indiaToday(m.at);
            const sep = d !== lastDay;
            lastDay = d;
            return (
              <div key={m.id}>
                {sep ? (
                  <p className="my-3 text-center text-[11px] font-semibold text-muted-foreground">
                    {day(d)}
                  </p>
                ) : null}
                <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words",
                      mine
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md bg-muted",
                    )}
                  >
                    {m.text}
                    <span className="mt-0.5 block text-right text-[10px] opacity-60">
                      {m.at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={end} />
      </div>
      {error ? (
        <p role="alert" className="px-1 pb-1 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <form
        className="flex items-end gap-2 border-t border-border pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label="Message"
          rows={1}
          maxLength={2000}
          placeholder={`Message ${otherName}`}
          className="max-h-32 min-h-11 flex-1 resize-none text-base"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          className="size-11"
          disabled={!text.trim() || sending}
          aria-label="Send"
        >
          {sending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <SendHorizontal aria-hidden />
          )}
        </Button>
      </form>
    </section>
  );
}
