import { useEffect, useState } from 'react';
import { apiBaseUrl, getHealth } from '../../lib/api';

type Phase = 'loading' | 'success' | 'error';

interface HealthState {
  phase: Phase;
  status?: string;
  error?: string;
}

/**
 * Calls the backend `GET /health` on mount and renders explicit
 * loading / success / error states.
 *
 * Backend-neutral: the displayed status comes from whichever backend
 * `VITE_API_BASE_URL` points at, which is also shown so it is clear the
 * frontend is not bound to a specific backend.
 *
 * Accessibility: the live region announces phase changes; status is
 * communicated with text + an icon, never color alone.
 */
export function HealthStatus() {
  const [state, setState] = useState<HealthState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;

    getHealth()
      .then((health) => {
        if (active) {
          setState({ phase: 'success', status: health.status });
        }
      })
      .catch((err: unknown) => {
        if (active) {
          const message =
            err instanceof Error ? err.message : 'Unknown error';
          setState({ phase: 'error', error: message });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      aria-labelledby="health-heading"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <h2
        id="health-heading"
        className="text-lg font-semibold text-slate-900 dark:text-slate-100"
      >
        Backend health
      </h2>

      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        API base URL:{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {apiBaseUrl}
        </code>
      </p>

      <div role="status" aria-live="polite" className="mt-4">
        {state.phase === 'loading' && (
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <span aria-hidden="true">⏳</span>
            <span>Checking backend health…</span>
          </p>
        )}

        {state.phase === 'success' && (
          <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
            <span aria-hidden="true">✓</span>
            <span>
              Backend reachable — status: {state.status}
            </span>
          </p>
        )}

        {state.phase === 'error' && (
          <p
            role="alert"
            className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400"
          >
            <span aria-hidden="true">⚠</span>
            <span>Could not reach backend: {state.error}</span>
          </p>
        )}
      </div>
    </section>
  );
}

export default HealthStatus;
