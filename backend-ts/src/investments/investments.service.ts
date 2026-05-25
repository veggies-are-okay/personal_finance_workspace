import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { HoldingEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { formatMoney } from '../transactions/transactions.service';
import { formatPercent } from '../budget/budget.service';
import {
  AllocationDto,
  ConcentrationDto,
  HoldingDto,
  InvestmentsDto,
} from './investments-response.dto';

/**
 * Thin read of the `holdings` table (parity twin of the FastAPI
 * `build_investments`). NO analytics are recomputed — both backends apply the
 * SAME deterministic aggregation to the SAME rows, so for identical DB state
 * both return byte-identical bodies (DA-9 / DA-23):
 *
 *  - `portfolio_value` = sum of every holding's `value`;
 *  - `unrealized_gain` = sum of every holding's `gain`;
 *  - `allocation[]`    = holdings grouped by `asset_class` -> per class `amount`
 *    (sum of value), `actual_pct` (class share of the portfolio's market value),
 *    `target_pct` (sum of the class's stored per-holding `weight` values);
 *  - `concentration[]` = per holding `{holding: symbol, weight}` where weight is
 *    the holding's market-value share of the portfolio;
 *  - `holdings[]`      = the rows verbatim (stored per-holding `weight`).
 *
 * Money is summed in integer CENTS (never float) so the totals are byte-
 * identical to FastAPI's `Decimal` sum. Ordering matches FastAPI exactly
 * (allocation by class; concentration by descending weight then symbol;
 * holdings by symbol). Money is a 2dp decimal STRING (DA-2); percentages are
 * JSON NUMBERS 0-100 (DA-22). An empty DB yields `"0.00"` totals + empty
 * arrays. A DB failure becomes the same canonical 503 FastAPI returns (DA-18).
 */
@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(HoldingEntity)
    private readonly holdings: Repository<HoldingEntity>,
  ) {}

  // Asset class for holdings whose `asset_class` is NULL (matches FastAPI).
  private static readonly UNCLASSIFIED = 'unclassified';

  async get(): Promise<InvestmentsDto> {
    let rows: HoldingEntity[];
    try {
      rows = await this.holdings.find({ order: { symbol: 'ASC' } });
    } catch {
      // DB down / table missing / connection refused -> canonical 503 (DA-18).
      throw new CanonicalServiceUnavailableException();
    }

    // Sum money in integer cents so totals match FastAPI's Decimal sum exactly.
    let portfolioCents = 0n;
    let gainCents = 0n;
    for (const row of rows) {
      portfolioCents += toCents(row.value);
      gainCents += toCents(row.gain);
    }

    // Group by asset class: accumulate market value (cents) + summed weights.
    const classCents = new Map<string, bigint>();
    const classTarget = new Map<string, number>();
    for (const row of rows) {
      const assetClass = row.assetClass ?? InvestmentsService.UNCLASSIFIED;
      classCents.set(
        assetClass,
        (classCents.get(assetClass) ?? 0n) + toCents(row.value),
      );
      classTarget.set(
        assetClass,
        (classTarget.get(assetClass) ?? 0) + Number(row.weight),
      );
    }

    const allocation: AllocationDto[] = [...classCents.keys()]
      .sort()
      .map((assetClass) => ({
        class: assetClass,
        target_pct: roundPercent(classTarget.get(assetClass) ?? 0),
        actual_pct: pct(classCents.get(assetClass) ?? 0n, portfolioCents),
        amount: centsToMoney(classCents.get(assetClass) ?? 0n),
      }));

    // Concentration: each holding's market-value share, ranked by descending
    // weight then symbol (stable tiebreak so both backends agree).
    const concentration: ConcentrationDto[] = rows
      .map((row) => ({
        holding: row.symbol,
        weight: pct(toCents(row.value), portfolioCents),
      }))
      .sort(
        (a, b) => b.weight - a.weight || a.holding.localeCompare(b.holding),
      );

    const holdingsOut: HoldingDto[] = rows.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      value: formatMoney(row.value),
      weight: formatPercent(row.weight),
      gain: formatMoney(row.gain),
    }));

    return {
      portfolio_value: centsToMoney(portfolioCents),
      unrealized_gain: centsToMoney(gainCents),
      allocation,
      concentration,
      holdings: holdingsOut,
    };
  }
}

/**
 * Parse a `NUMERIC(14,2)` money string into integer CENTS (a `bigint`), so sums
 * never go through a float. Mirrors the 2dp scale FastAPI's `Decimal` carries.
 */
export function toCents(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[-+]/, '');
  const [intPart = '0', fracRaw = ''] = unsigned.split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const cents = BigInt(intPart || '0') * 100n + BigInt(frac || '0');
  return negative ? -cents : cents;
}

/** Render integer CENTS as a 2dp decimal money STRING (Appendix A / DA-2). */
export function centsToMoney(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / 100n;
  const rem = abs % 100n;
  const frac = rem.toString().padStart(2, '0');
  const sign = negative && abs !== 0n ? '-' : '';
  return `${sign}${dollars.toString()}.${frac}`;
}

/**
 * Percentage (0-100, one decimal) of `part` over `whole`, both integer cents.
 * Returns 0 when `whole` is 0 (matches FastAPI's zero-portfolio guard). The
 * division is exact enough at cent scale that `toFixed(1)` matches FastAPI's
 * `Decimal.quantize("0.1")` for the synthetic fixtures (clean 1dp boundaries).
 */
export function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) {
    return 0;
  }
  return roundPercent((Number(part) / Number(whole)) * 100);
}

/** Quantize a percentage to one decimal place, as a JSON number (DA-22). */
export function roundPercent(value: number): number {
  return Number(value.toFixed(1));
}
