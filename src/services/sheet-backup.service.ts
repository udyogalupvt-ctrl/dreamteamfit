import { callServer, getServer } from "@/lib/server-api";
import type { SheetBackupStatus } from "@/lib/sheet-backup/status";

export type { SheetBackupStatus } from "@/lib/sheet-backup/status";

interface SyncReply {
  ok: boolean;
  done: boolean;
  busy: boolean;
  pending: number;
  error: string | null;
}

/** Owner only. */
export const getSheetBackupStatus = () => getServer<SheetBackupStatus>("/api/backup/sheet/status");

/** Owner only. Another sheet (the app must be able to open it; the error says how to share it). */
export const saveSheetLink = (sheetUrl: string) =>
  callServer<{ ok: boolean; sheetUrl: string }>("/api/backup/sheet/settings", { sheetUrl });

const MAX_CALLS = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Owner only. Rebuilds the whole sheet: the first call asks for a full run, then the page keeps
 * calling until the server says it is done. `onProgress(n)` gets the step number (1, 2, 3 …).
 * Throws with a plain message when Google refuses and nothing is getting done.
 */
export async function syncSheetNow(onProgress: (step: number) => void): Promise<void> {
  let lastPending = Infinity;
  let queued = false; // the "full" request has reached the server (it was not turned away as busy)
  for (let call = 1; call <= MAX_CALLS; call++) {
    onProgress(call);
    const r = await callServer<SyncReply>("/api/backup/sheet/sync", queued ? {} : { mode: "full" });
    if (r.busy) {
      // Another update (a sale being saved, or the night job) is running: wait and ask again.
      await sleep(5000);
      continue;
    }
    queued = true;
    if (r.done) {
      if (r.error) throw new Error(r.error);
      return;
    }
    // Stop when Google keeps refusing and the steps left are not going down.
    if (r.error && r.pending >= lastPending) throw new Error(r.error);
    lastPending = r.pending;
  }
  throw new Error("The sheet is still updating. Press Sync now again in a minute.");
}
