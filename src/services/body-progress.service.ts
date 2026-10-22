/**
 * Body progress from the desk (src/lib/body-progress.ts). The member and trainer apps write
 * through the server (src/server/portal-progress.ts); the desk writes bodyProgress/{clientId}
 * here, the whole list in a transaction, and may change any entry.
 */
import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from "@/lib/firestore";
import { auth, db } from "@/lib/firebase";
import { todayISO } from "@/lib/format";
import { cleanBodyEntry, putEntry, readEntries, validateBodyEntry } from "@/lib/body-progress";
import type { BodyEntry, BodyEntryAuthor, BodyEntryInput } from "@/types/models";

const ref = (clientId: string) => doc(db, "bodyProgress", clientId);

/** The desk's name on the entries it logs. */
export const deskAuthor = (): BodyEntryAuthor => ({
  kind: "staff",
  id: auth.currentUser?.uid ?? "",
  name: auth.currentUser?.displayName || auth.currentUser?.email || "Gym",
});

export function subscribeBodyProgress(
  clientId: string,
  onData: (entries: BodyEntry[]) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(ref(clientId), (snap) => onData(readEntries(snap.data())), onError);
}

async function change(clientId: string, apply: (entries: BodyEntry[]) => BodyEntry[]) {
  await runTransaction(db, async (tx) => {
    const entries = readEntries((await tx.get(ref(clientId))).data());
    tx.set(ref(clientId), { clientId, entries: apply(entries), updatedAt: serverTimestamp() });
  });
}

/** Adds an entry (no id) or changes one. Returns the entry's id. */
export async function saveBodyEntry(clientId: string, input: BodyEntryInput, id?: string) {
  const entry = cleanBodyEntry(input);
  const problem = validateBodyEntry(entry, todayISO());
  if (problem) throw new Error(problem);
  const entryId = id || doc(collection(db, "bodyProgress")).id;
  await change(clientId, (entries) => {
    if (id && !entries.some((e) => e.id === id))
      throw new Error("This entry was removed. Refresh to see the latest list.");
    return putEntry(entries, { ...entry, id: entryId, by: deskAuthor(), at: Date.now() });
  });
  return entryId;
}

/** Removes an entry; the returned undo puts the same entry back (same author and date). */
export async function deleteBodyEntry(clientId: string, entry: BodyEntry) {
  await change(clientId, (entries) => entries.filter((e) => e.id !== entry.id));
  return () => change(clientId, (entries) => putEntry(entries, entry));
}
