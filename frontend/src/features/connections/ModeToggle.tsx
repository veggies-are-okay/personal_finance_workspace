/**
 * The per-source Local ↔ API segmented toggle. Switching mode calls the
 * connections API (`setSourceMode`) — mocked in dev/tests until P6.4 wires the
 * adapter swap end-to-end. Implemented as a radiogroup so it is keyboard- and
 * screen-reader-navigable; the busy mode is announced via `aria-busy`.
 */

import { useState } from 'react';
import { setSourceMode } from '../../lib/api';
import type { Source, SourceMode } from '../../lib/types';

const MODES: { value: SourceMode; label: string }[] = [
  { value: 'local', label: 'Local file' },
  { value: 'api', label: 'Live API' },
];

const selectedClass =
  'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50';
const idleClass =
  'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200';

export function ModeToggle({
  source,
  mode,
  onModeChanged,
}: {
  source: Source;
  mode: SourceMode;
  /** Called with the refreshed snapshot after a successful switch. */
  onModeChanged?: (next: SourceMode) => void;
}) {
  const [busyMode, setBusyMode] = useState<SourceMode | null>(null);
  const [error, setError] = useState<string | undefined>();

  function switchTo(next: SourceMode) {
    if (next === mode || busyMode) return;
    setError(undefined);
    setBusyMode(next);
    setSourceMode(source, next)
      .then(() => {
        onModeChanged?.(next);
      })
      .catch(() => {
        setError('Could not switch mode.');
      })
      .finally(() => {
        setBusyMode(null);
      });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        role="radiogroup"
        aria-label={`Data mode for ${source}`}
        aria-busy={busyMode !== null}
        className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
      >
        {MODES.map((m) => {
          const isSelected = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={busyMode !== null}
              onClick={() => switchTo(m.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 ${
                isSelected ? selectedClass : idleClass
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
