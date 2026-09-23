import { useEffect, useState } from "react";

export interface LiveState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribes to a real-time source. `subscribe` receives data/error callbacks and
 * returns an unsubscribe function. Re-subscribes when `deps` change.
 */
export function useLive<T>(
  subscribe: ((onData: (d: T) => void, onError: (e: Error) => void) => () => void) | null,
  initial: T,
  deps: unknown[],
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: initial, loading: true, error: null });

  useEffect(() => {
    if (!subscribe) {
      setState({ data: initial, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    return subscribe(
      (data) => setState({ data, loading: false, error: null }),
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
