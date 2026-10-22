/**
 * Announcements in the member app (src/lib/app-announcement.ts).
 *
 *   GET /api/portal/announcements  member: the newest ones meant for them
 *
 * The newest one also comes inside /api/portal/me (latestAnnouncement) for the Home card. Ids sort
 * newest first (announcementId), so "lists this member" needs no orderBy and no extra index.
 */
import type { PortalAnnouncement } from "@/constants/portal";
import { APP_LIST_MAX } from "@/lib/app-announcement";
import { db, json, localDate } from "./admin";
import { s } from "./portal-common";

const millis = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

async function forMember(clientId: string, max: number): Promise<PortalAnnouncement[]> {
  const snap = await db()
    .collection("announcements")
    .where("appClientIds", "array-contains", clientId)
    .limit(max)
    .get();
  return snap.docs.map((d) => {
    const a = d.data();
    const ms = millis(a["createdAt"]);
    return {
      id: d.id,
      message: s(a["message"]),
      sentOn: ms ? localDate(new Date(ms)) : localDate(),
      edited: !!a["editedAt"],
    };
  });
}

export async function latestAnnouncement(clientId: string) {
  return (await forMember(clientId, 1))[0] ?? null;
}

export async function memberAnnouncements(clientId: string) {
  return json({ items: await forMember(clientId, APP_LIST_MAX) });
}
