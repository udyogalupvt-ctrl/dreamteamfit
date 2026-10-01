import { useEffect, useRef, useState } from "react";

export interface LiveState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** Errors a retry can't fix (a query the database refuses as written). */
const PERMANENT = new Set(["failed-precondition", "invalid-argument"]);
/** 2 s, 5 s, 15 s, then every 30 s. */
const retryDelay = (tries: number) => [2000, 5000, 15000][tries - 1] ?? 30000;

/**
 * Subscribes to a real-time source. `subscribe` receives data/error callbacks and
 * returns an unsubscribe function. Re-subscribes when `deps` change.
 *
 * A live listener that fails (connection dropped, sign-in being refreshed, database busy) stops
 * for good, which used to leave a page saying "not connected" until it was refreshed: it is
 * started again by itself (after 2 s, 5 s, 15 s, then every 30 s), keeping the last data shown.
 */
export function useLive<T>(
  subscribe: ((onData: (d: T) => void, onError: (e: Error) => void) => () => void) | null,
  initial: T,
  deps: unknown[],
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: initial, loading: true, error: null });
  const [retry, setRetry] = useState(0);
  const tries = useRef(0);

  useEffect(() => {
    if (!subscribe) {
      setState({ data: initial, loading: false, error: null });
      return;
    }
    // A retry keeps showing what was there; a new subscription shows loading.
    if (!tries.current) setState((s) => ({ ...s, loading: true, error: null }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(
      (data) => {
        tries.current = 0;
        setState({ data, loading: false, error: null });
      },
      (error) => {
        setState((s) => ({ ...s, loading: false, error }));
        if (PERMANENT.has(String((error as { code?: string }).code ?? ""))) return;
        tries.current += 1;
        timer = setTimeout(() => setRetry((n) => n + 1), retryDelay(tries.current));
      },
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retry]);

  // New deps = a new source: start counting retries again.
  useEffect(
    () => () => {
      tries.current = 0;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  return state;
}
