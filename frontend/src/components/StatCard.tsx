import { Card } from './Card';

/**
 * A single KPI in the 4-up stat row at the top of each screen.
 * `tone` colors the optional delta; never relies on color alone — the delta
 * text carries an explicit + / - sign.
 */
export function StatCard({
  label,
  value,
  delta,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: 'up' | 'down' | 'neutral';
}) {
  const toneClass = {
    up: 'text-brand-700 dark:text-brand-400',
    down: 'text-red-700 dark:text-red-400',
    neutral: 'text-slate-500 dark:text-slate-400',
  }[tone];

  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </p>
      {delta !== undefined && (
        <p className={`mt-1 text-sm font-medium tabular-nums ${toneClass}`}>{delta}</p>
      )}
    </Card>
  );
}

/** The responsive 4-up grid wrapper for stat cards. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}
