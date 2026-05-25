import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TransactionEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { TransactionQueryDto } from './transaction-query.dto';
import {
  PaginatedTransactionsDto,
  TransactionDto,
} from './transaction-response.dto';

/**
 * Thin read of the precomputed/normalized `transactions` table (parity twin of
 * the FastAPI `list_transactions`). No recompute — same DB, same filters, same
 * ordering, so both backends return identical bodies for the same request.
 *
 * - LEFT JOIN `accounts` to resolve the human account name.
 * - Filters: date range, account name, category, free-text `q` (ILIKE).
 * - Deterministic ordering: date DESC, then id DESC (matches FastAPI).
 * - `total` is the full match count IGNORING pagination, so an `offset` past the
 *   end yields empty `data` with a correct `total` (DA-4).
 * - Money is emitted as a 2dp decimal STRING (Appendix A / DA-2); a DB failure
 *   becomes a canonical 503 (DA-18).
 */
@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(TransactionEntity)
    private readonly transactions: Repository<TransactionEntity>,
  ) {}

  async list(query: TransactionQueryDto): Promise<PaginatedTransactionsDto> {
    const qb = this.transactions
      .createQueryBuilder('t')
      .leftJoin('accounts', 'a', 'a.id = t.account_id')
      .select([
        't.date AS date',
        'a.name AS account',
        't.description AS description',
        't.category AS category',
        't.bucket AS bucket',
        't.amount AS amount',
        't.is_recurring AS is_recurring',
      ]);

    if (query.date_from !== undefined) {
      qb.andWhere('t.date >= :dateFrom', { dateFrom: query.date_from });
    }
    if (query.date_to !== undefined) {
      qb.andWhere('t.date <= :dateTo', { dateTo: query.date_to });
    }
    if (query.account !== undefined) {
      qb.andWhere('a.name = :account', { account: query.account });
    }
    if (query.category !== undefined) {
      qb.andWhere('t.category = :category', { category: query.category });
    }
    if (query.q !== undefined) {
      qb.andWhere('t.description ILIKE :q', { q: `%${query.q}%` });
    }

    let rows: RawRow[];
    let total: number;
    try {
      // Total IGNORING pagination (DA-4): count the filtered set first.
      total = await qb.getCount();
      rows = await qb
        .orderBy('t.date', 'DESC')
        .addOrderBy('t.id', 'DESC')
        .limit(query.limit)
        .offset(query.offset)
        .getRawMany<RawRow>();
    } catch {
      // DB down / table missing / connection refused -> canonical 503 (DA-18).
      throw new CanonicalServiceUnavailableException();
    }

    const data: TransactionDto[] = rows.map((row) => this.toDto(row));
    return {
      data,
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }

  /** Map a raw joined row to the wire DTO (money -> 2dp string, omit absents). */
  private toDto(row: RawRow): TransactionDto {
    const dto: TransactionDto = {
      date: formatDate(row.date),
      account: row.account ?? '',
      description: row.description,
      amount: formatMoney(row.amount),
      is_recurring: Boolean(row.is_recurring),
    };
    // Omit absent optionals (DA-6): never emit null/undefined keys.
    if (row.category !== null && row.category !== undefined) {
      dto.category = row.category;
    }
    if (row.bucket !== null && row.bucket !== undefined) {
      dto.bucket = row.bucket;
    }
    return dto;
  }
}

/** Shape of a raw row returned by the query builder. */
interface RawRow {
  date: Date | string;
  account: string | null;
  description: string;
  category: string | null;
  bucket: string | null;
  amount: string;
  is_recurring: boolean;
}

/** Render a DB date (Date or string) as `YYYY-MM-DD` (Appendix A / DA-3). */
export function formatDate(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  // pg returns `date` columns as `YYYY-MM-DD` strings already.
  return value.slice(0, 10);
}

/**
 * Render money as a fixed-2dp decimal string (Appendix A / DA-2), e.g. "-4.75".
 *
 * Formats the DB `NUMERIC(14,2)` value as a STRING without ever going through a
 * float (the repo's money rule: never native `number` for money), so the result
 * is byte-identical to FastAPI's `f"{Decimal:.2f}"`. Postgres already returns
 * the column at scale 2, but we re-normalize defensively (pad/truncate to 2dp,
 * preserve sign, never emit `-0.00`).
 */
export function formatMoney(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[-+]/, '');
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const frac = (fracRaw + '00').slice(0, 2);
  const isZero = /^0+$/.test(intPart) && /^0+$/.test(frac || '0');
  const sign = negative && !isZero ? '-' : '';
  return `${sign}${intPart}.${frac}`;
}
