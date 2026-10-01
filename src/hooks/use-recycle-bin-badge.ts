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

/** Menu badge (owner, or a login with the Recycle Bin page): things others deleted since last opened. */
export function useRecycleBinBadge() {
  const { can } = useAccess();
  const { user } = useAuth();
  const all = can("recycleBin");
  const live = useLive<RecycleBinEntry[]>(
    all && user
      ? (ok, fail) => subscribeRecycleBin({ owner: true, uid: user.uid }, ok, fail)
      : null,
    [],
    [all, user?.uid],
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
