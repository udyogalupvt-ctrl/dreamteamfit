import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { announcementText, cleanMessage, firstName } from "@/lib/announcement";
import type { Announcement, AnnouncementGroup, AnnouncementRecipient } from "@/types/models";
import { getBusinessSettings } from "./business-settings.service";
import { COLLECTIONS, subscribeCollection, toDate } from "./firestore.service";
import { sendWhatsAppMessage } from "./whatsapp.service";
import { getWhatsAppSettings, isWhatsAppApiLive } from "./whatsapp-settings.service";

export const mapAnnouncement = (id: string, d: DocumentData): Announcement => ({
  id,
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
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const subscribeAnnouncements = (ok: (x: Announcement[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.announcements,
    mapAnnouncement,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );

export async function createAnnouncement(
  input: {
    message: string;
    groups: AnnouncementGroup[];
    typedNumbers: number;
    recipients: AnnouncementRecipient[];
    skipped: number;
  },
  by: { uid: string; name: string },
) {
  const ref = doc(collection(db, COLLECTIONS.announcements));
  await setDoc(ref, {
    ...input,
    message: cleanMessage(input.message),
    total: input.recipients.length,
    sent: 0,
    failed: 0,
    status: "sending",
    createdByUid: by.uid,
    createdByName: by.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
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
    throw new Error("WhatsApp Cloud API is off. Turn it on in Settings & WhatsApp.");
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
