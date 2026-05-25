import { describe, expect, it } from 'vitest';
import {
  formatDelta,
  formatMoney,
  formatPercent,
  isNegativeMoney,
} from './format';

describe('formatMoney', () => {
  it('formats a positive decimal string as USD currency', () => {
    expect(formatMoney('1234.50')).toBe('$1,234.50');
  });

  it('formats a negative amount (money out) with a leading minus', () => {
    expect(formatMoney('-4.75')).toBe('-$4.75');
  });

  it('renders large values compactly when requested', () => {
    expect(formatMoney('96200.00', { compact: true })).toBe('$96.2K');
  });

  it('does not compact values below 1000', () => {
    expect(formatMoney('420.00', { compact: true })).toBe('$420.00');
  });

  it('returns the raw input when it is not a number', () => {
    expect(formatMoney('not-money')).toBe('not-money');
  });
});

describe('isNegativeMoney', () => {
  it('is true for negative strings and false otherwise', () => {
    expect(isNegativeMoney('-1.00')).toBe(true);
    expect(isNegativeMoney('1.00')).toBe(false);
    expect(isNegativeMoney('0.00')).toBe(false);
  });
});

describe('formatPercent', () => {
  it('formats integers and one-decimal percentages', () => {
    expect(formatPercent(26)).toBe('26%');
    expect(formatPercent(18.5)).toBe('18.5%');
  });

  it('rounds to one decimal place', () => {
    expect(formatPercent(33.333)).toBe('33.3%');
  });
});

describe('formatDelta', () => {
  it('prefixes positive deltas with a plus sign', () => {
    expect(formatDelta('2940.00')).toBe('+$2,940.00');
  });

  it('keeps the native minus sign for negative deltas', () => {
    expect(formatDelta('-410.00')).toBe('-$410.00');
  });
});
