/**
 * Tells the server "something changed" after a staff member saves, so the Google Sheet backup
 * catches up within about a minute. Called by the write wrapper (src/lib/firestore.ts) after a
 * write has gone through. It never delays or breaks a save: every error is swallowed.
 */
import { auth } from "@/lib/firebase";
import { createToucher } from "@/lib/sheet-backup/touch";

/** Wait before sending (ms). Tests can shorten it with `window.__SHEET_TOUCH_MS`. */
const delayMs = () => {
  const w = typeof window === "undefined" ? undefined : (window as { __SHEET_TOUCH_MS?: unknown });
  const n = Number(w?.__SHEET_TOUCH_MS);
  return Number.isFinite(n) && n >= 0 && w?.__SHEET_TOUCH_MS !== undefined ? n : 60_000;
};

async function send(paths: string[], keepalive: boolean) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return;
  await fetch("/api/backup/sheet/touch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    keepalive,
  });
}

const toucher = createToucher({
  delayMs,
  // Only a signed-in staff browser; the member app signs in elsewhere and the server also checks.
  canSend: () => typeof window !== "undefined" && Boolean(auth.currentUser),
  send,
});

if (typeof document !== "undefined") {
  // Leaving the page: send what is waiting now (keepalive lets the request finish after the tab closes).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") toucher.flush(true);
  });
}

/** `paths` look like `payments/abc`. Unwatched collections are ignored. */
export function noteChanged(paths: string[]): void {
  toucher.note(paths);
}
