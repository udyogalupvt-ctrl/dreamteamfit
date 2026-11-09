/**
 * Anonymous feedback QR links and their inbox (src/lib/anon-feedback.ts). The public page writes
 * through the server (src/server/anon-feedback.ts); "Member feedback" logins manage links and
 * resolve messages here. Lists sort on the phone, so no Firestore index is needed.
 */
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import {
  ANON_LIMITS,
  cleanLinkName,
  newFeedbackToken,
  validateLinkName,
} from "@/lib/anon-feedback";
import { subscribeQuery, toDate } from "./firestore.service";
import type { AnonFeedback, FeedbackKind, FeedbackLink } from "@/types/models";

const links = () => collection(db, "feedbackLinks");
const msgs = () => collection(db, "anonymousFeedback");
const who = () => auth.currentUser?.displayName || auth.currentUser?.email || "Staff";
const when = (v: unknown) => (v ? toDate(v) : null);
const KINDS = ["complaint", "idea", "praise"];

const toLink = (id: string, d: DocumentData): FeedbackLink => ({
  id,
  name: String(d["name"] ?? ""),
  active: d["active"] !== false,
  responseCount: Number(d["responseCount"] ?? 0) || 0,
  lastResponseAt: when(d["lastResponseAt"]),
  createdBy: String(d["createdBy"] ?? ""),
  createdAt: when(d["createdAt"]),
});

const toMsg = (id: string, d: DocumentData): AnonFeedback => ({
  id,
  linkId: String(d["linkId"] ?? ""),
  linkName: String(d["linkName"] ?? ""),
  kind: (KINDS.includes(d["kind"]) ? d["kind"] : "idea") as FeedbackKind,
  rating: Number(d["rating"] ?? 0) || 0,
  message: String(d["message"] ?? ""),
  day: String(d["day"] ?? ""),
  createdAt: when(d["createdAt"]),
  status: d["status"] === "resolved" ? "resolved" : "new",
  note: String(d["note"] ?? ""),
  noteBy: String(d["noteBy"] ?? ""),
  resolvedBy: String(d["resolvedBy"] ?? ""),
  resolvedAt: when(d["resolvedAt"]),
});

const newestFirst = <T extends { createdAt: Date | null }>(items: T[]) =>
  [...items].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

// ------------------------------------------------------------------ links

export function subscribeFeedbackLinks(
  onData: (items: FeedbackLink[]) => void,
  onError: (e: Error) => void,
) {
  return subscribeQuery(
    query(links(), limit(200)),
    toLink,
    (items) => onData(newestFirst(items)),
    onError,
  );
}

/** A new QR link; returns its token. */
export async function createFeedbackLink(rawName: string): Promise<string> {
  const name = cleanLinkName(rawName);
  const problem = validateLinkName(name);
  if (problem) throw new Error(problem);
  const token = newFeedbackToken();
  await setDoc(doc(links(), token), {
    name,
    active: true,
    responseCount: 0,
    lastResponseAt: null,
    rate: null,
    createdBy: who(),
    createdAt: serverTimestamp(),
    updatedBy: who(),
    updatedAt: serverTimestamp(),
  });
  return token;
}

export async function renameFeedbackLink(id: string, rawName: string) {
  const name = cleanLinkName(rawName);
  const problem = validateLinkName(name);
  if (problem) throw new Error(problem);
  await updateDoc(doc(links(), id), { name, updatedBy: who(), updatedAt: serverTimestamp() });
}

export async function setFeedbackLinkActive(id: string, active: boolean) {
  await updateDoc(doc(links(), id), { active, updatedBy: who(), updatedAt: serverTimestamp() });
}

/** Only a link nobody has written from yet (rules check it too). */
export async function deleteFeedbackLink(link: FeedbackLink) {
  if (link.responseCount > 0)
    throw new Error("This QR already has feedback. Switch it off instead.");
  await deleteDoc(doc(links(), link.id));
}

// ------------------------------------------------------------------ messages

type Live = (items: AnonFeedback[]) => void;

/** Messages nobody has dealt with yet (the inbox and the sidebar badge). */
export function subscribeNewAnonFeedback(onData: Live, onError: (e: Error) => void, max = 300) {
  return subscribeQuery(
    query(msgs(), where("status", "==", "new"), limit(max)),
    toMsg,
    (items) => onData(newestFirst(items)),
    onError,
  );
}

/** Everything sent in a period (YYYY-MM-DD, India time); "All dates" leaves the open end out. */
export function subscribeAnonFeedbackBetween(
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
    query(msgs(), ...range, orderBy("createdAt", "desc"), limit(500)),
    toMsg,
    (items) => onData(newestFirst(items)),
    onError,
  );
}

export async function setAnonFeedbackResolved(item: AnonFeedback, resolved: boolean) {
  await updateDoc(doc(msgs(), item.id), {
    status: resolved ? "resolved" : "new",
    resolvedBy: resolved ? who() : "",
    resolvedAt: resolved ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

export async function saveAnonFeedbackNote(item: AnonFeedback, raw: string) {
  const note = raw.trim();
  if (note.length > ANON_LIMITS.note)
    throw new Error(`Keep the note under ${ANON_LIMITS.note} characters.`);
  await updateDoc(doc(msgs(), item.id), {
    note,
    noteBy: note ? who() : "",
    updatedAt: serverTimestamp(),
  });
}

/** Owner only (rules): spam or abuse. */
export async function deleteAnonFeedback(item: AnonFeedback) {
  await deleteDoc(doc(msgs(), item.id));
}
