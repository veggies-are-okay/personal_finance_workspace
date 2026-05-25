/**
 * Per-source file-upload control for the Settings / Data Sources screen.
 *
 * Owner drops (or picks) their raw files and they flow through the Python-only
 * `POST /api/v1/ingest/{source}` endpoint: extract -> load -> recompute. In
 * Docker this is a same-origin request that nginx routes to backend-python
 * regardless of which frontend instance served the SPA (ingestion is
 * Python-only — the TS backend does not implement it).
 *
 * States (all observable + announced to assistive tech):
 *   - idle     — a labelled file picker that doubles as a drag-and-drop target
 *   - selected — chosen file names listed, with an "Upload & ingest" action
 *   - loading  — request in flight (button busy, aria-busy)
 *   - success  — per-file detected types + rows loaded (role="status")
 *   - error    — the canonical error message (role="alert")
 *
 * On success it calls `onIngested()` so the screen can invalidate/refetch the
 * dashboard data the new rows feed.
 */

import { useId, useRef, useState } from 'react';
import { ApiRequestError, ingestSource } from '../../lib/api';
import type { IngestSource, IngestSummary } from '../../lib/types';
import { UPLOAD_META } from './sourceMeta';

type UploadPhase = 'idle' | 'loading' | 'success' | 'error';

export function UploadControl({
  source,
  onIngested,
}: {
  source: IngestSource;
  /** Called after a successful ingest so the screen can refetch affected data. */
  onIngested?: (summary: IngestSummary) => void;
}) {
  const meta = UPLOAD_META[source];
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState(false);

  function acceptFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = meta.multiple ? Array.from(list) : [list[0]];
    setFiles(next);
    setPhase('idle');
    setSummary(null);
    setError(undefined);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    acceptFiles(event.dataTransfer.files);
  }

  function clearSelection() {
    setFiles([]);
    setSummary(null);
    setError(undefined);
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  }

  function upload() {
    if (files.length === 0 || phase === 'loading') return;
    setPhase('loading');
    setError(undefined);
    setSummary(null);
    ingestSource(source, files)
      .then((result) => {
        setSummary(result);
        setPhase('success');
        setFiles([]);
        if (inputRef.current) inputRef.current.value = '';
        onIngested?.(result);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof ApiRequestError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Upload failed.';
        setError(message);
        setPhase('error');
      });
  }

  const dropZoneClass = dragOver
    ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/30'
    : 'border-slate-300 bg-slate-50 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-brand-500';

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col gap-2 rounded-lg border border-dashed p-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${dropZoneClass}`}
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor={inputId}
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <span aria-hidden="true">⬆</span>
            Choose file{meta.multiple ? 's' : ''}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={meta.accept}
            multiple={meta.multiple}
            onChange={(e) => acceptFiles(e.target.files)}
            className="sr-only"
            aria-describedby={`${inputId}-hint`}
          />
          <span id={`${inputId}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
            {meta.hint} <span className="text-slate-400">or drag &amp; drop here.</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {files.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              disabled={phase === 'loading'}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-500 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={upload}
            disabled={files.length === 0 || phase === 'loading'}
            aria-busy={phase === 'loading'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {phase === 'loading' && (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
              />
            )}
            {phase === 'loading' ? 'Uploading…' : 'Upload & ingest'}
          </button>
        </div>
      </div>

      {files.length > 0 && phase !== 'success' && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {files.map((f) => (
            <li key={f.name} className="font-mono">
              {f.name}
            </li>
          ))}
        </ul>
      )}

      {phase === 'success' && summary && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <span className="font-medium">
            Loaded {summary.total_rows} row{summary.total_rows === 1 ? '' : 's'} from{' '}
            {summary.files.length} file{summary.files.length === 1 ? '' : 's'}.
          </span>
          <ul className="flex flex-col gap-0.5 text-xs">
            {summary.files.map((f) => (
              <li key={f.filename} className="font-mono">
                {f.filename} — {f.detected_type} · {f.rows} row{f.rows === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === 'error' && error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}
