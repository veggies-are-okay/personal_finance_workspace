/**
 * `useApi` — the shared async-data state machine every screen uses.
 *
 * It calls a fetcher on mount (and when `deps` change) and resolves to exactly
 * one of four observable states:
 *   - `loading`        — request in flight
 *   - `error`          — request rejected (non-2xx / network); carries a message
 *   - `not_connected`  — request succeeded but the payload is "empty" per the
 *                        `isEmpty` predicate (DA-20: a source not yet connected
 *                        returns 200 + empty data; we show a friendly empty
 *                        state, NOT an error)
 *   - `success`        — request succeeded with populated data
 *
 * Keeping this in one place means screens express loading/empty/error/
 * not_connected uniformly and tests assert the same observable behavior.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from './api';

export type ApiPhase = 'loading' | 'success' | 'error' | 'not_connected';

export interface ApiState<T> {
  phase: ApiPhase;
  data?: T;
  error?: string;
  /** Re-run the fetcher (used by error-state "Try again" buttons). */
  reload: () => void;
}

export interface UseApiOptions<T> {
  /**
   * Returns true when a successful payload should be treated as the
   * not-connected empty state instead of `success`.
   */
  isEmpty?: (data: T) => boolean;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options: UseApiOptions<T> = {},
): ApiState<T> {
  const [state, setState] = useState<Omit<ApiState<T>, 'reload'>>({
    phase: 'loading',
  });
  const [nonce, setNonce] = useState(0);
  const { isEmpty } = options;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    // Reset to the loading state when deps change / on reload. This is an
    // intentional synchronous reset (the request is about to start), not a
    // derived-state cascade, so the set-state-in-effect heuristic is suppressed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ phase: 'loading' });

    fetcher()
      .then((data) => {
        if (!active) return;
        if (isEmpty?.(data)) {
          setState({ phase: 'not_connected', data });
        } else {
          setState({ phase: 'success', data });
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message =
          err instanceof ApiRequestError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Something went wrong.';
        setState({ phase: 'error', error: message });
      });

    return () => {
      active = false;
    };
    // `fetcher`/`isEmpty` are intentionally excluded; `deps` + `nonce` drive reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { ...state, reload };
}
