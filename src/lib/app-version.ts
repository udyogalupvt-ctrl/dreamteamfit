import { useSyncExternalStore } from "react";

/**
 * Set when the live app is newer than this tab (src/routes/__root.tsx checks /api/version): the
 * top bar shows a "New version" button until the tab is refreshed.
 */
let newer = false;
const listeners = new Set<() => void>();

export function markNewVersion() {
  if (newer) return;
  newer = true;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

/** True while a newer version of the app is live than the one running in this tab. */
export const useNewVersionReady = () =>
  useSyncExternalStore(
    subscribe,
    () => newer,
    () => false,
  );
