/**
 * Body progress from the member app and the trainer app (src/lib/body-progress.ts).
 *
 *   POST /api/portal/body-log           member: { action: "save", id?, entry } | { action: "delete", id }
 *   POST /api/portal/trainer-body-log   trainer: the same + clientId (a member they run PT for)
 *
 * The entries reach the apps inside /api/portal/me and /api/portal/trainer-member. All of a
 * member's entries are one doc, bodyProgress/{clientId}, changed in a transaction.
 */
import { FieldValue } from "firebase-admin/firestore";
import type { BodyEntry, BodyEntryAuthor } from "@/types/models";
import {
  BODY_LIMITS,
  canChangeEntry,
  cleanBodyEntry,
  entryLine,
  putEntry,
  readEntries,
  validateBodyEntry,
} from "@/lib/body-progress";
import { db, json, localDate } from "./admin";
import { appLog, isOurImage, liveMember, s } from "./portal-common";

const docOf = (clientId: string) => db().doc(`bodyProgress/${clientId}`);

export async function bodyEntries(clientId: string): Promise<BodyEntry[]> {
  return readEntries((await docOf(clientId).get()).data());
}

class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Saves or deletes one entry. The caller has already checked who may log for this member (a
 * member logs for themselves, a trainer for a member they run PT for); a member's name comes from
 * their record.
 */
export async function changeBodyEntry(
  actor: BodyEntryAuthor,
  clientId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!clientId || clientId.includes("/")) return json({ error: "Pick a member." }, 400);
  const member = actor.kind === "member" ? await liveMember(clientId) : null;
  if (member && !member.ok) return member.response;
  const client = member?.ok ? member.data : (await db().doc(`clients/${clientId}`).get()).data();
  if (!client) return json({ error: "This member account no longer exists." }, 404);
  const by = actor.kind === "member" ? { ...actor, name: s(client["fullName"]) } : actor;

  const del = body["action"] === "delete";
  const id = s(body["id"]).trim();
  if (del && !id) return json({ error: "Pick the entry to delete." }, 400);
  const input = cleanBodyEntry(body["entry"]);
  if (!del) {
    const problem = validateBodyEntry(input, localDate());
    if (problem) return json({ error: problem }, 400);
    if (!input.photos.every(isOurImage)) return json({ error: "Upload the photo again." }, 400);
  }

  const ref = docOf(clientId);
  const newId = id || db().collection("bodyProgress").doc().id;
  let removed: BodyEntry | undefined;
  try {
    await db().runTransaction(async (tx) => {
      const entries = readEntries((await tx.get(ref)).data());
      const old = id ? entries.find((e) => e.id === id) : undefined;
      if (id && !old)
        throw new Refused("This entry was removed. Refresh to see the latest list.", 404);
      if (old && !canChangeEntry(old, by))
        throw new Refused("You can change only the entries you added.", 403);
      if (!old && entries.length >= BODY_LIMITS.entries)
        throw new Refused("This member has too many entries. Ask the gym to remove old ones.", 400);
      removed = old;
      const next = del
        ? entries.filter((e) => e.id !== id)
        : putEntry(entries, { ...input, id: newId, by, at: Date.now() });
      tx.set(ref, { clientId, entries: next, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    throw e;
  }

  const line = del ? entryLine(removed!) || "photos" : entryLine(input) || "photos";
  await appLog({
    collection: "bodyProgress",
    docId: clientId,
    action: del ? "deleted" : id ? "updated" : "created",
    summary: `${del ? "Removed" : id ? "Changed" : "Logged"} body progress (${del ? removed!.date : input.date}): ${line}`,
    actorName: by.name || (by.kind === "trainer" ? "Trainer" : "Member"),
    clientId,
    clientName: s(client["fullName"]),
  });
  return json({ ok: true, id: newId });
}
