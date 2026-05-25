/**
 * Display formatting for Appendix A wire types.
 *
 * Money arrives as a fixed 2dp decimal STRING (never a JS number) to avoid
 * float rounding; we format it for display without doing arithmetic on it.
 * Percentages arrive as numbers on a 0-100 scale.
 */

/** Parse a money string to a number for formatting ONLY (never for storage). */
function moneyToNumber(value: string): number {
  return Number.parseFloat(value);
}

/**
 * Format a money string as currency, e.g. "1234.50" → "$1,234.50",
 * "-4.75" → "-$4.75". `compact` renders large values as "$96.2K" / "$1.2M".
 */
export function formatMoney(value: string, opts: { compact?: boolean } = {}): string {
  const n = moneyToNumber(value);
  if (Number.isNaN(n)) return value;
  if (opts.compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** True when a money string represents a negative amount (money out). */
export function isNegativeMoney(value: string): boolean {
  return moneyToNumber(value) < 0;
}

/** Format a 0-100 percentage number, e.g. 26 → "26%", 18.5 → "18.5%". */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

/** Render a signed money delta with an explicit + / - and arrow, e.g. "+$2,940.00". */
export function formatDelta(value: string): string {
  const n = moneyToNumber(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatMoney(value)}`;
}
