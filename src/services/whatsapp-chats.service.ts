import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import { callServer } from "@/lib/server-api";
import { subscribeQuery, toDate } from "./firestore.service";

/** One WhatsApp chat (a member or anyone who messaged the gym's Cloud API number). */
export interface WaChat {
  id: string;
  waId: string;
  profileName: string;
  clientId: string;
  clientName: string;
  clientPhotoUrl: string | null;
  clientCode: string;
  lastMessageAt: Date | null;
  lastText: string;
  lastDirection: "in" | "out";
  lastStatus: string;
  lastInboundAt: Date | null;
  unread: number;
}

export interface WaMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  text: string;
  caption: string;
  filename: string;
  template: string;
  media: { id: string; mime: string; voice?: boolean } | null;
  location: { lat: number; lng: number; name: string; address: string } | null;
  contact: { name: string; phone: string } | null;
  at: Date;
  status: string;
  error: string;
  by: string;
  replyTo: string;
  reaction: string;
}

const optDate = (v: unknown) => (v ? toDate(v) : null);

const mapChat = (id: string, d: DocumentData): WaChat => ({
  id,
  waId: d["waId"] ?? id,
  profileName: d["profileName"] ?? "",
  clientId: d["clientId"] ?? "",
  clientName: d["clientName"] ?? "",
  clientPhotoUrl: d["clientPhotoUrl"] ?? null,
  clientCode: d["clientCode"] ?? "",
  lastMessageAt: optDate(d["lastMessageAt"]),
  lastText: d["lastText"] ?? "",
  lastDirection: d["lastDirection"] === "out" ? "out" : "in",
  lastStatus: d["lastStatus"] ?? "",
  lastInboundAt: optDate(d["lastInboundAt"]),
  unread: Number(d["unread"] ?? 0),
});

const mapMessage = (id: string, d: DocumentData): WaMessage => ({
  id,
  direction: d["direction"] === "out" ? "out" : "in",
  type: d["type"] ?? "text",
  text: d["text"] ?? "",
  caption: d["caption"] ?? "",
  filename: d["filename"] ?? "",
  template: d["template"] ?? "",
  media: d["media"] ?? null,
  location: d["location"] ?? null,
  contact: d["contact"] ?? null,
  at: toDate(d["at"]),
  status: d["status"] ?? "",
  error: d["error"] ?? "",
  by: d["by"] ?? "",
  replyTo: d["replyTo"] ?? "",
  reaction: d["reaction"] ?? "",
});

/** The latest chats first (only `max` of them are loaded). */
export function subscribeChats(
  max: number,
  onData: (c: WaChat[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(collection(db, "waChats"), orderBy("lastMessageAt", "desc"), limit(max)),
    mapChat,
    onData,
    onError,
  );
}

/** Chats with unread messages, for the sidebar badge. */
export function subscribeUnreadChats(onData: (c: WaChat[]) => void, onError: (e: Error) => void) {
  return subscribeQuery(
    query(collection(db, "waChats"), where("unread", ">", 0), limit(100)),
    mapChat,
    onData,
    onError,
  );
}

export function subscribeChat(
  waId: string,
  onData: (c: WaChat | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "waChats", waId),
    (s) => onData(s.exists() ? mapChat(s.id, s.data()) : null),
    onError,
  );
}

/** The last `max` messages of a chat, oldest first. */
export function subscribeMessages(
  waId: string,
  max: number,
  onData: (m: WaMessage[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(collection(db, "waChats", waId, "messages"), orderBy("at", "desc"), limit(max)),
    mapMessage,
    (items) => onData(items.reverse()),
    onError,
  );
}

export const replyToChat = (waId: string, text: string, replyTo?: string) =>
  callServer<{ ok: true; id: string }>("/api/whatsapp/chat/reply", { waId, text, replyTo });

export const markChatRead = (waId: string) =>
  callServer<{ ok: true }>("/api/whatsapp/chat/read", { waId });

export const chatSetupStatus = () =>
  callServer<{ connected: boolean; appSecret: boolean; webhook: "ok" | "refused" | "never" }>(
    "/api/whatsapp/chat/status",
  );

/** A photo / voice note / file of a message, as a local link the page can show. */
export async function chatMediaUrl(waId: string, messageId: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again.");
  const r = await fetch(
    `/api/whatsapp/chat/media?chat=${encodeURIComponent(waId)}&msg=${encodeURIComponent(messageId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || "File unavailable");
  return URL.createObjectURL(await r.blob());
}

/** WhatsApp allows a free-form reply only within 24 hours of the member's last message. */
export const replyWindowOpen = (c: Pick<WaChat, "lastInboundAt">, now = Date.now()) =>
  !!c.lastInboundAt && now - c.lastInboundAt.getTime() < 24 * 60 * 60 * 1000;

/** "+91 98498 34102" */
export function prettyWaNumber(waId: string) {
  if (waId.length === 12 && waId.startsWith("91"))
    return `+91 ${waId.slice(2, 7)} ${waId.slice(7)}`;
  return `+${waId}`;
}
