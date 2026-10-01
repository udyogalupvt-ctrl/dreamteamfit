import { useEffect, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { useLive } from "@/hooks/use-live-query";
import { subscribeRecycleBin } from "@/services/recycle-bin-list.service";
import type { RecycleBinEntry } from "@/types/models";

/** When the owner last opened the Recycle Bin (this device), for the menu's "new" count. */
export const RECYCLE_BIN_SEEN_KEY = "rf-bin-seen";
const seenAt = () => {
  try {
    return Number(localStorage.getItem(RECYCLE_BIN_SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
};

/** Menu badge (owner): things other people deleted since the owner last opened the bin. */
export function useRecycleBinBadge() {
  const { owner } = useAccess();
  const { user } = useAuth();
  const live = useLive<RecycleBinEntry[]>(
    owner && user
      ? (ok, fail) => subscribeRecycleBin({ owner: true, uid: user.uid }, ok, fail)
      : null,
    [],
    [owner, user?.uid],
  );
  const [seen, setSeen] = useState(seenAt);
  useEffect(() => {
    const update = () => setSeen(seenAt());
    window.addEventListener(RECYCLE_BIN_SEEN_KEY, update);
    return () => window.removeEventListener(RECYCLE_BIN_SEEN_KEY, update);
  }, []);
  return live.data.filter((e) => e.deletedByUid !== user?.uid && e.deletedAt.getTime() > seen)
    .length;
}
