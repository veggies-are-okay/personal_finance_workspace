/** A small status/category pill. Tone maps to a full static class string. */
const TONE_CLASS = {
  needs: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  wants: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  savings: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  positive: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
} as const;

export type BadgeTone = keyof typeof TONE_CLASS;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
