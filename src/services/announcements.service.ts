import {
  collection,
  doc,
  getDocs,
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
import { announcementText, cleanMessage, firstName } from "@/lib/announcement";
import {
  announcementId,
  appMessageProblem,
  channelOf,
  cleanAppMessage,
} from "@/lib/app-announcement";
import { callServer } from "@/lib/server-api";
import type {
  Announcement,
  AnnouncementChannel,
  AnnouncementGroup,
  AnnouncementRecipient,
} from "@/types/models";
import { getBusinessSettings } from "./business-settings.service";
import { COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";
import { sendWhatsAppMessage } from "./whatsapp.service";
import {
  getWhatsAppSettings,
  isWhatsAppApiLive,
  sendsFromPhone,
} from "./whatsapp-settings.service";

const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const who = () => auth.currentUser?.displayName || auth.currentUser?.email || "Staff";

export const mapAnnouncement = (id: string, d: DocumentData): Announcement => ({
  id,
  channel: channelOf(d["channel"]),
  message: d["message"] ?? "",
  groups: d["groups"] ?? [],
  typedNumbers: Number(d["typedNumbers"] ?? 0),
  recipients: d["recipients"] ?? [],
  total: Number(d["total"] ?? 0),
  sent: Number(d["sent"] ?? 0),
  failed: Number(d["failed"] ?? 0),
  skipped: Number(d["skipped"] ?? 0),
  status: d["status"] === "done" ? "done" : "sending",
  createdByUid: d["createdByUid"] ?? "",
  createdByName: d["createdByName"] ?? "",
  appClientIds: ids(d["appClientIds"]),
  pushed: typeof d["pushed"] === "number" ? d["pushed"] : null,
  removedClientIds: ids(d["removedClientIds"]),
  removedAt: d["removedAt"] ? toDate(d["removedAt"]) : null,
  removedByName: d["removedByName"] ?? "",
  editedAt: d["editedAt"] ? toDate(d["editedAt"]) : null,
  editedByName: d["editedByName"] ?? "",
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

/** Announcements page history: the newest ones (app posts are free, so there can be many). */
export const HISTORY_MAX = 50;

export const subscribeAnnouncements = (ok: (x: Announcement[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.announcements,
    mapAnnouncement,
    ok,
    fail,
    orderBy("createdAt", "desc"),
    limit(HISTORY_MAX),
  );

/**
 * Saves the announcement. "app": shows in the members' apps at once (free, nothing more to send).
 * "whatsapp": also in their apps, and runAnnouncement then sends the WhatsApp messages.
 */
export async function createAnnouncement(
  input: {
    channel: AnnouncementChannel;
    message: string;
    groups: AnnouncementGroup[];
    typedNumbers: number;
    recipients: AnnouncementRecipient[];
    skipped: number;
    appClientIds: string[];
  },
  by: { uid: string; name: string },
) {
  const app = input.channel === "app";
  const message = app ? cleanAppMessage(input.message) : cleanMessage(input.message);
  const problem = appMessageProblem(message);
  if (problem) throw new Error(problem);
  const ref = doc(db, COLLECTIONS.announcements, announcementId());
  await setDoc(ref, {
    ...input,
    message,
    recipients: app ? [] : input.recipients,
    typedNumbers: app ? 0 : input.typedNumbers,
    skipped: app ? 0 : input.skipped,
    total: app ? input.appClientIds.length : input.recipients.length,
    sent: 0,
    failed: 0,
    status: app ? "done" : "sending",
    pushed: null,
    removedClientIds: [],
    removedAt: null,
    removedByName: "",
    editedAt: null,
    editedByName: "",
    createdByUid: by.uid,
    createdByName: by.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * The free phone notification for the app copy (members who turned notifications on). The server
 * sends it once per announcement; returns how many phones it reached.
 */
export async function notifyAnnouncement(id: string) {
  const r = await callServer<{ sent: number }>("/api/push/announcement", { id });
  return r.sent;
}

/** Fix a member app announcement after posting. No new notification goes out. */
export async function editAppAnnouncement(a: Announcement, message: string) {
  const text = cleanAppMessage(message);
  const problem = appMessageProblem(text);
  if (problem) throw new Error(problem);
  if (a.channel !== "app") throw new Error("Only member app announcements can be changed.");
  await updateDoc(doc(db, COLLECTIONS.announcements, a.id), {
    message: text,
    editedAt: serverTimestamp(),
    editedByName: who(),
    updatedAt: serverTimestamp(),
  });
}

/** Takes it off the members' apps (WhatsApp messages already sent stay sent). */
export async function removeFromApp(a: Announcement) {
  if (!a.appClientIds.length) return;
  await updateDoc(doc(db, COLLECTIONS.announcements, a.id), {
    appClientIds: [],
    removedClientIds: a.appClientIds,
    removedAt: serverTimestamp(),
    removedByName: who(),
    updatedAt: serverTimestamp(),
  });
}

/** Undo of removeFromApp: the same members see it again (no new notification). */
export async function showInAppAgain(a: Pick<Announcement, "id" | "removedClientIds">) {
  if (!a.removedClientIds.length) return;
  await updateDoc(doc(db, COLLECTIONS.announcements, a.id), {
    appClientIds: a.removedClientIds,
    removedClientIds: [],
    removedAt: null,
    removedByName: "",
    updatedAt: serverTimestamp(),
  });
}

const SENT = new Set(["sent", "delivered", "read"]);

/**
 * Sends to everyone in the list who has not got it yet, 3 at a time. Each number has one
 * message record per announcement (whatsappMessages/announcement__{id}_{phone}), so running it
 * again, from any phone, only reaches the ones left and never sends anyone a second copy.
 */
export async function runAnnouncement(
  a: Pick<Announcement, "id" | "message" | "recipients">,
  onProgress: (done: number, total: number) => void,
) {
  const [wa, business] = await Promise.all([getWhatsAppSettings(), getBusinessSettings()]);
  if (!isWhatsAppApiLive(wa))
    throw new Error("Automatic WhatsApp is off. Turn it on in Settings & WhatsApp.");
  // A message to many people unasked is what gets a number banned: never from the gym's own one.
  if (sendsFromPhone(wa))
    throw new Error("Announcements aren't sent from the gym's own WhatsApp number.");
  const gym = business.businessName || "our gym";
  const message = cleanMessage(a.message);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < a.recipients.length) {
      const r = a.recipients[next++]!;
      await sendWhatsAppMessage({
        client: {
          id: r.clientId,
          fullName: r.name,
          phone: r.phone,
          whatsappPhone: r.phone,
          whatsappOptIn: true,
        },
        type: "announcement",
        referenceId: `${a.id}_${r.phone}`,
        templateName: wa.announcementTemplate,
        templateLanguage: wa.templateLanguage,
        parameters: [firstName(r.name), gym, message],
        messagePreview: announcementText(r.name, gym, message),
        provider: wa.mode,
      }).catch(() => undefined); // a failure is saved on that person's message record
      onProgress(++done, a.recipients.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // Count from the message records, so a second run (or another phone) is counted right.
  const snap = await getDocs(
    query(
      collection(db, COLLECTIONS.whatsappMessages),
      where("referenceId", ">=", `${a.id}_`),
      where("referenceId", "<=", `${a.id}_\uf8ff`),
    ),
  );
  const sent = snap.docs.filter((d) => SENT.has(String(d.data()["status"]))).length;
  const failed = Math.max(0, a.recipients.length - sent);
  await updateDoc(doc(db, COLLECTIONS.announcements, a.id), {
    sent,
    failed,
    status: "done",
    updatedAt: serverTimestamp(),
  });
  return { sent, failed, total: a.recipients.length };
}
