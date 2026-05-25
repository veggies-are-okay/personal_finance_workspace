/**
 * A labeled horizontal meter for "target vs actual" rows (50/30/20 buckets,
 * investment allocation). Uses a real <progress>-like ARIA meter so the value
 * is announced; the target tick is rendered visually and described in the label.
 */

export function MeterRow({
  label,
  actualPct,
  targetPct,
  amount,
  colorClass,
}: {
  label: string;
  actualPct: number;
  targetPct?: number;
  amount: string;
  colorClass: string;
}) {
  const clampedActual = Math.max(0, Math.min(100, actualPct));
  const clampedTarget =
    targetPct === undefined ? undefined : Math.max(0, Math.min(100, targetPct));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium capitalize text-slate-700 dark:text-slate-200">
          {label}
        </span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          {amount} · {Math.round(clampedActual * 10) / 10}%
          {clampedTarget !== undefined && ` of ${clampedTarget}% target`}
        </span>
      </div>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="meter"
        aria-label={`${label}: ${Math.round(clampedActual)}% actual${
          clampedTarget !== undefined ? `, ${clampedTarget}% target` : ''
        }`}
        aria-valuenow={Math.round(clampedActual)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`${colorClass} h-full rounded-full`}
          style={{ width: `${clampedActual}%` }}
        />
        {clampedTarget !== undefined && (
          <span
            aria-hidden="true"
            className="absolute top-0 h-full w-0.5 bg-slate-900/60 dark:bg-white/70"
            style={{ left: `${clampedTarget}%` }}
          />
        )}
      </div>
    </div>
  );
}
