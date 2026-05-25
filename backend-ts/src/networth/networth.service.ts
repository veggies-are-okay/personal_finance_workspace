import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AccountEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { formatMoney } from '../transactions/transactions.service';
import {
  NetWorthAccountDto,
  NetWorthDto,
  NetWorthSeriesPointDto,
} from './networth-response.dto';

/**
 * Thin read of the `accounts` table (parity twin of the FastAPI
 * `build_networth`). NO recompute, NO synthesized history — both backends read
 * the SAME rows, so for the same DB state both return byte-identical bodies
 * (DA-9 / DA-23):
 *
 *  - `net_worth`   = sum of ALL account balances (= assets - liabilities);
 *  - `assets`      = sum of POSITIVE balances;
 *  - `liabilities` = absolute sum of NEGATIVE balances (money-out convention);
 *  - `accounts[]`  = one row per account (sorted by name, then id) with its
 *    current balance and a `delta_30d` of "0.00" (the snapshot table holds no
 *    history, so a clock-derived delta would break parity);
 *  - `series[]`    = EMPTY (no monthly history source exists yet).
 *
 * A null balance counts as 0. Money is a 2dp decimal STRING (DA-2). An empty DB
 * yields all-zero totals + empty arrays. A DB failure becomes the same canonical
 * 503 FastAPI returns (DA-18).
 *
 * Money arithmetic is done in INTEGER CENTS so it never touches a float (the
 * repo's money rule), byte-identical to FastAPI's `Decimal` totals.
 */
@Injectable()
export class NetWorthService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly accounts: Repository<AccountEntity>,
  ) {}

  // `window` mirrors the contract param; the snapshot has no history to window
  // over, so it does not change the result (parity with FastAPI's `_window`).
  async get(window: string): Promise<NetWorthDto> {
    // Accepted for contract parity with the other view endpoints; the snapshot
    // totals do not depend on it (there is no history to window over).
    void window;

    let rows: AccountEntity[];
    try {
      rows = await this.accounts.find({
        order: { name: 'ASC', id: 'ASC' },
      });
    } catch {
      // DB down / table missing / connection refused -> canonical 503 (DA-18).
      throw new CanonicalServiceUnavailableException();
    }

    let assetsCents = 0n;
    let liabilitiesCents = 0n;
    const accounts: NetWorthAccountDto[] = rows.map((row) => {
      const cents = toCents(row.balance);
      if (cents > 0n) {
        assetsCents += cents;
      } else if (cents < 0n) {
        liabilitiesCents += -cents;
      }
      return {
        name: row.name,
        type: row.type,
        balance: formatMoney(centsToDecimalString(cents)),
        // No balance history -> a well-formed zero delta (never clock-derived).
        delta_30d: '0.00',
      };
    });

    const netWorthCents = assetsCents - liabilitiesCents;
    // No history source -> series is empty; neither backend fabricates it.
    const series: NetWorthSeriesPointDto[] = [];

    return {
      net_worth: formatMoney(centsToDecimalString(netWorthCents)),
      assets: formatMoney(centsToDecimalString(assetsCents)),
      liabilities: formatMoney(centsToDecimalString(liabilitiesCents)),
      series,
      accounts,
    };
  }
}

/**
 * Parse a `NUMERIC(14,2)` balance string (or null) into signed integer cents.
 *
 * Postgres returns `numeric` as a string; a null balance counts as 0. Working in
 * integer cents keeps the totals exact (no float), byte-identical to FastAPI's
 * `Decimal` arithmetic.
 */
export function toCents(value: string | null): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[-+]/, '');
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const frac = (fracRaw + '00').slice(0, 2);
  const magnitude = BigInt(intPart) * 100n + BigInt(frac || '0');
  return negative ? -magnitude : magnitude;
}

/** Render signed integer cents as a signed `INT.FF` decimal string. */
export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const intPart = magnitude / 100n;
  const frac = (magnitude % 100n).toString().padStart(2, '0');
  const sign = negative && magnitude !== 0n ? '-' : '';
  return `${sign}${intPart.toString()}.${frac}`;
}
