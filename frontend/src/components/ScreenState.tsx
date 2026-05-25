import type { ReactNode } from 'react';
import type { ApiState } from '../lib/useApi';

/**
 * Renders the loading / error / not_connected states uniformly and, on success,
 * hands the loaded data to `children`. Every screen wraps its body in this so
 * the four observable states are consistent and individually testable.
 *
 * `not_connected` (DA-20) is a friendly empty state, NOT an error: a source
 * that has not been linked yet returns 200 with an empty payload, and we invite
 * the owner to connect it rather than showing a failure.
 */
export function ScreenState<T>({
  state,
  emptyTitle = 'Nothing here yet',
  emptyBody = 'This source is not connected yet. Connect it in Data Sources to see your data here.',
  children,
}: {
  state: ApiState<T>;
  emptyTitle?: string;
  emptyBody?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.phase === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-8 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      >
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 motion-reduce:animate-none"
        />
        <span>Loading…</span>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-red-800 sm:flex-row sm:items-center sm:justify-between dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      >
        <p className="flex items-center gap-2">
          <span aria-hidden="true">⚠</span>
          <span>{state.error ?? 'Could not load this view.'}</span>
        </p>
        <button
          type="button"
          onClick={state.reload}
          className="self-start rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-800 dark:bg-transparent dark:text-red-200 dark:hover:bg-red-900/40"
        >
          Try again
        </button>
      </div>
    );
  }

  if (state.phase === 'not_connected') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
        <span aria-hidden="true" className="text-2xl">
          🔌
        </span>
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {emptyTitle}
        </h2>
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{emptyBody}</p>
      </div>
    );
  }

  // success
  return <>{children(state.data as T)}</>;
}
