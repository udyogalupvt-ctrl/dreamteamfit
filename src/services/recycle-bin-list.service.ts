import { orderBy, query, where, type DocumentData } from "@/lib/firestore";
import type { RecycleBinEntry } from "@/types/models";
import { col, COLLECTIONS, subscribeQuery, toDate } from "./firestore.service";

/**
 * Reading the Recycle Bin (kept apart from recycle-bin.service, so the menu's badge doesn't load
 * the delete / restore code on every page).
 */
export const mapBinEntry = (id: string, d: DocumentData): RecycleBinEntry => ({
  id,
  section: d["section"] ?? "members",
  label: d["label"] ?? "",
  detail: d["detail"] ?? "",
  count: Number(d["count"] ?? 0),
  deletedBy: d["deletedBy"] ?? "",
  deletedByUid: d["deletedByUid"] ?? "",
  deletedByRole: d["deletedByRole"] ?? "",
  deletedAt: toDate(d["deletedAt"]),
  extra: (d["extra"] as Record<string, unknown>) ?? {},
});

/** The owner sees everything in the bin; a staff login only what it deleted. */
export const subscribeRecycleBin = (
  viewer: { owner: boolean; uid: string },
  ok: (x: RecycleBinEntry[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    viewer.owner
      ? query(col(COLLECTIONS.recycleBin), orderBy("deletedAt", "desc"))
      : query(col(COLLECTIONS.recycleBin), where("deletedByUid", "==", viewer.uid)),
    mapBinEntry,
    (x) => ok(x.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())),
    fail,
  );
