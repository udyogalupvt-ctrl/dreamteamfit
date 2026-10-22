/**
 * The member feedback inbox (src/lib/feedback.ts). Members send from their app through the server
 * (src/server/portal-feedback.ts); logins with "Member feedback" read, reply and resolve here.
 * Lists sort on the phone, so no Firestore index is needed.
 */
import {
  collection,
  doc,
  limit,
  orderBy,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import { validateReply } from "@/lib/feedback";
import { reviewUrlProblem } from "@/lib/review-prompt";
import { callServer } from "@/lib/server-api";
import { todayISO } from "@/lib/format";
import { subscribeQuery, toDate } from "./firestore.service";
import type { Client, Feedback, FeedbackKind, MemberAppSettings } from "@/types/models";

const col = () => collection(db, "feedback");
const who = () => auth.currentUser?.displayName || auth.currentUser?.email || "Staff";
const when = (v: unknown) => (v ? toDate(v) : null);

const toFeedback = (id: string, d: DocumentData): Feedback => ({
  id,
  clientId: String(d["clientId"] ?? ""),
  clientName: String(d["clientName"] ?? ""),
  memberCode: String(d["memberCode"] ?? ""),
  phone: String(d["phone"] ?? ""),
  kind: (["complaint", "idea", "praise"].includes(d["kind"]) ? d["kind"] : "idea") as FeedbackKind,
  message: String(d["message"] ?? ""),
  wantsCall: d["wantsCall"] === true,
  status: d["status"] === "resolved" ? "resolved" : "new",
  reply: String(d["reply"] ?? ""),
  repliedBy: String(d["repliedBy"] ?? ""),
  repliedAt: when(d["repliedAt"]),
  resolvedBy: String(d["resolvedBy"] ?? ""),
  resolvedAt: when(d["resolvedAt"]),
  createdAt: when(d["createdAt"]),
});

const newestFirst = (items: Feedback[]) =>
  [...items].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

type Live = (items: Feedback[]) => void;

/** Messages nobody has dealt with yet (the inbox and the sidebar badge). */
export function subscribeNewFeedback(onData: Live, onError: (e: Error) => void, max = 200) {
  return subscribeQuery(
    query(col(), where("status", "==", "new"), limit(max)),
    toFeedback,
    (items) => onData(newestFirst(items)),
    onError,
  );
}

/**
 * Everything sent in a period (from / to = YYYY-MM-DD, India time). "All dates" (0000 … 9999)
 * leaves the open end out: Firestore can't hold a year 0 or 10000 date.
 */
export function subscribeFeedbackBetween(
  from: string,
  to: string,
  onData: Live,
  onError: (e: Error) => void,
) {
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);
  const range = [
    ...(from > "2000" ? [where("createdAt", ">=", start)] : []),
    ...(to < "9000" ? [where("createdAt", "<", end)] : []),
  ];
  return subscribeQuery(
    // Newest first before the limit, so a busy period drops the oldest, not the newest.
    query(col(), ...range, orderBy("createdAt", "desc"), limit(500)),
    toFeedback,
    (items) => onData(newestFirst(items)),
    onError,
  );
}

/** One member's messages (their profile and /feedback?client=…). */
export function subscribeMemberFeedback(
  clientId: string,
  onData: Live,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(col(), where("clientId", "==", clientId), limit(200)),
    toFeedback,
    (items) => onData(newestFirst(items)),
    onError,
  );
}

/**
 * Saves the gym's reply (the member sees it in their app and gets a notification). Answering
 * also closes the message unless `keepOpen`.
 */
export async function replyToFeedback(item: Feedback, reply: string, keepOpen = false) {
  const text = reply.trim();
  const problem = validateReply(text);
  if (problem) throw new Error(problem);
  if (!text) throw new Error("Write the reply first.");
  await updateDoc(doc(col(), item.id), {
    reply: text,
    repliedBy: who(),
    repliedAt: serverTimestamp(),
    ...(keepOpen ? {} : { status: "resolved", resolvedBy: who(), resolvedAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  });
  // The notification is a bonus: the reply is saved even when the phone can't be reached.
  await callServer("/api/push/feedback", { id: item.id }).catch(() => undefined);
}

export async function setFeedbackResolved(item: Feedback, resolved: boolean) {
  await updateDoc(doc(col(), item.id), {
    status: resolved ? "resolved" : "new",
    resolvedBy: resolved ? who() : "",
    resolvedAt: resolved ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

// ------------------------------------------------------------------ Google review link

const appRef = () => doc(db, "settings", "memberApp");

export function subscribeMemberAppSettings(
  onData: (s: MemberAppSettings) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    appRef(),
    (snap) => onData({ googleReviewUrl: String(snap.data()?.["googleReviewUrl"] ?? "") }),
    onError,
  );
}

export async function saveGoogleReviewUrl(url: string) {
  const value = url.trim();
  const problem = reviewUrlProblem(value);
  if (problem) throw new Error(problem);
  await setDoc(appRef(), {
    googleReviewUrl: value,
    updatedAt: serverTimestamp(),
    updatedBy: who(),
  });
}

/** The desk sent the review link on WhatsApp from its own phone: noted on the member. */
export async function markReviewAsked(client: Client) {
  await updateDoc(doc(db, "clients", client.id), {
    // One field only: the member's own tap ("review.tappedAt") may land at the same moment.
    "review.askedAt": todayISO(),
  });
}
