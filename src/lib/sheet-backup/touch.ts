// Pure part of the "tell the server something changed" ping (no React, no Firebase), so it is
// unit-tested. The browser wiring is in src/lib/sheet-backup-touch.ts.

/** Collections whose changes show up in the Google Sheet (same list the server watches). */
export const WATCHED = new Set([
  "payments",
  "invoices",
  "memberships",
  "ptAssignments",
  "clients",
  "expenses",
  "packages",
  "ptPackages",
  "trainers",
  "staff",
  "recycleBin",
  "recycleBinItems",
]);

/** The server takes at most this many paths per call. */
export const MAX_PATHS = 200;

/** Keep only document paths like `payments/abc` that belong to a watched collection. */
export function watchedPaths(paths: string[]): string[] {
  return paths.filter((p) => {
    const parts = p.split("/");
    return parts.length === 2 && parts[1] !== "" && WATCHED.has(parts[0]!);
  });
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

/**
 * Collects changed paths and sends them in one go after `delayMs`. The wait starts at the FIRST
 * change and is not pushed back by later ones, so a busy front desk still reaches the sheet
 * within the delay. `flush()` sends right away (page hidden). Never throws.
 */
export function createToucher(opts: {
  delayMs: () => number;
  /** False when nothing may be sent (nobody signed in). */
  canSend: () => boolean;
  send: (paths: string[], keepalive: boolean) => Promise<unknown> | void;
  timers?: Timers;
}) {
  const timers: Timers = opts.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const pending = new Set<string>();
  let handle: unknown = null;

  const flush = (keepalive = false) => {
    if (handle !== null) {
      timers.clear(handle);
      handle = null;
    }
    if (!pending.size) return;
    const all = [...pending];
    pending.clear();
    try {
      if (!opts.canSend()) return;
      for (let i = 0; i < all.length; i += MAX_PATHS) {
        const sent = opts.send(all.slice(i, i + MAX_PATHS), keepalive);
        if (sent && typeof (sent as Promise<unknown>).catch === "function")
          (sent as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // A failed ping is shown on the Backup page; it must never disturb the write that caused it.
    }
  };

  const note = (paths: string[]) => {
    try {
      const keep = watchedPaths(paths);
      if (!keep.length) return;
      keep.forEach((p) => pending.add(p));
      if (handle === null) {
        let ms = 60_000;
        try {
          ms = opts.delayMs();
        } catch {
          // use the default
        }
        handle = timers.set(() => flush(false), ms);
      }
    } catch {
      // never throws
    }
  };

  return { note, flush, pendingCount: () => pending.size };
}
