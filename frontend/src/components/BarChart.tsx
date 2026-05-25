/**
 * A small dependency-free stacked bar chart for monthly series (net-worth
 * composition, needs/wants trend). Values are money strings; we parse them for
 * geometry only. Purely presentational and decorative for assistive tech — the
 * underlying numbers are always available in the adjacent tables/stats.
 */

export interface StackSegment {
  label: string;
  /** Money string. */
  value: string;
  /** A full static Tailwind bg class (no string interpolation). */
  colorClass: string;
}

export interface BarChartProps {
  /** One stacked bar per entry. */
  bars: { label: string; segments: StackSegment[] }[];
  /** Accessible description of what the chart shows. */
  title: string;
}

export function BarChart({ bars, title }: BarChartProps) {
  const totals = bars.map((bar) =>
    bar.segments.reduce((sum, s) => sum + Math.abs(Number.parseFloat(s.value)), 0),
  );
  const max = Math.max(1, ...totals);

  return (
    <figure aria-label={title} className="w-full">
      <div className="flex h-40 items-end gap-1" role="img" aria-label={title}>
        {bars.map((bar, i) => (
          <div key={bar.label} className="flex h-full flex-1 flex-col justify-end">
            <div className="flex w-full flex-col justify-end" style={{ height: '100%' }}>
              {bar.segments.map((seg) => {
                const h = (Math.abs(Number.parseFloat(seg.value)) / max) * 100;
                return (
                  <div
                    key={seg.label}
                    className={`${seg.colorClass} w-full first:rounded-t-sm`}
                    style={{ height: `${h}%` }}
                    title={`${bar.label} · ${seg.label}`}
                  />
                );
              })}
            </div>
            <span className="mt-1 hidden text-center text-[10px] text-slate-400 sm:block">
              {bar.label.slice(5)}
            </span>
            {/* mark the latest bar for screen-reader context */}
            {i === bars.length - 1 && <span className="sr-only">latest period</span>}
          </div>
        ))}
      </div>
    </figure>
  );
}
