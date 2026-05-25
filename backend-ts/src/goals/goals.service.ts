import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GoalEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { formatMoney } from '../transactions/transactions.service';
import {
  AffordabilityDto,
  GoalFundingDto,
  GoalsDto,
} from './goals-response.dto';

/**
 * Thin read of the `goals` table (parity twin of the FastAPI `build_goals`). NO
 * recompute beyond deterministic aggregation of the rows the ingestion layer
 * wrote (DA-23) — both backends read the SAME table, so for the same DB state
 * both return byte-identical bodies (DA-9 / design §3):
 *
 *  - `target`        = sum of every goal's `target`;
 *  - `saved`         = sum of every goal's `saved`;
 *  - `progress_pct`  = overall ratio `saved / target * 100` (0 when target 0);
 *  - `funding[]`     = one `{source, amount}` per goal (name + saved), ordered
 *    by name then id to match FastAPI exactly;
 *  - `affordability` = a zero-filled block (the P2.3 schema has no affordability
 *    table; neither backend fabricates data).
 *
 * Money is a 2dp decimal STRING (DA-2); `progress_pct`/`income_share` are JSON
 * NUMBERS 0-100 (DA-22). An empty DB yields zeros + empty funding. A DB failure
 * becomes the same canonical 503 FastAPI returns (DA-18).
 */
@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(GoalEntity)
    private readonly goals: Repository<GoalEntity>,
  ) {}

  // affordability has no backing table -> served as a well-formed zero block.
  private static readonly ZERO_AFFORDABILITY: AffordabilityDto = {
    price: '0.00',
    down_payment: '0.00',
    mortgage: '0.00',
    monthly_piti: '0.00',
    income_share: 0,
  };

  async get(): Promise<GoalsDto> {
    let rows: GoalEntity[];
    try {
      rows = await this.goals.find({ order: { name: 'ASC', id: 'ASC' } });
    } catch {
      // DB down / table missing / connection refused -> canonical 503 (DA-18).
      throw new CanonicalServiceUnavailableException();
    }

    // Sum in integer cents so the total is exact (parity with Python Decimal),
    // never via float accumulation.
    const targetCents = rows.reduce((acc, r) => acc + toCents(r.target), 0);
    const savedCents = rows.reduce((acc, r) => acc + toCents(r.saved), 0);

    // Overall progress: derived from the aggregate (per-goal progress_pct is not
    // summed), quantized to one decimal to match FastAPI's float(Decimal/0.1).
    const progress_pct =
      targetCents > 0
        ? Number(((savedCents / targetCents) * 100).toFixed(1))
        : 0;

    const funding: GoalFundingDto[] = rows.map((r) => ({
      source: r.name,
      amount: formatMoney(r.saved),
    }));

    return {
      target: formatMoney(centsToString(targetCents)),
      saved: formatMoney(centsToString(savedCents)),
      progress_pct,
      funding,
      affordability: GoalsService.ZERO_AFFORDABILITY,
    };
  }
}

/**
 * Parse a `NUMERIC(14,2)` decimal string into signed integer cents WITHOUT
 * floating point, so summing is exact (matches Python's `Decimal` arithmetic).
 */
export function toCents(value: string): number {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[-+]/, '');
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const frac = (fracRaw + '00').slice(0, 2);
  const cents = Number(intPart) * 100 + Number(frac);
  return negative ? -cents : cents;
}

/** Render signed integer cents back to a 2dp decimal string (e.g. -405 -> "-4.05"). */
export function centsToString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${intPart}.${frac}`;
}
