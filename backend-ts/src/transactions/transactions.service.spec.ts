import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TransactionEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { TransactionQueryDto } from './transaction-query.dto';
import {
  formatDate,
  formatMoney,
  TransactionsService,
} from './transactions.service';

/**
 * Unit tests for `TransactionsService` (parity twin of the FastAPI
 * `test_transactions.py`). The TypeORM `QueryBuilder` is faked so we assert the
 * service's behaviour — filter wiring, pagination, money/date mapping, omit of
 * absent optionals, and the canonical 503 on DB failure — without a live DB.
 */

interface RawRow {
  date: Date | string;
  account: string | null;
  description: string;
  category: string | null;
  bucket: string | null;
  amount: string;
  is_recurring: boolean;
}

function makeQueryBuilder(rows: RawRow[], count: number) {
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(count),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

const SEED: RawRow[] = [
  {
    date: '2026-05-20',
    account: 'Checking',
    description: 'Coffee Shop',
    category: 'dining',
    bucket: 'wants',
    amount: '-4.75',
    is_recurring: false,
  },
  {
    date: '2026-05-15',
    account: 'Checking',
    description: 'Paycheck',
    category: null,
    bucket: null,
    amount: '3100.00',
    is_recurring: false,
  },
];

describe('TransactionsService', () => {
  let service: TransactionsService;
  let qb: ReturnType<typeof makeQueryBuilder>;

  async function build(rows: RawRow[], count: number): Promise<void> {
    qb = makeQueryBuilder(rows, count);
    const repo: Partial<Repository<TransactionEntity>> = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getRepositoryToken(TransactionEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(TransactionsService);
  }

  const defaults = (): TransactionQueryDto =>
    Object.assign(new TransactionQueryDto(), { limit: 50, offset: 0 });

  it('returns the Paginated<T> envelope with total ignoring pagination', async () => {
    await build(SEED, 2);
    const result = await service.list(defaults());
    expect(result.pagination).toEqual({ limit: 50, offset: 0, total: 2 });
    expect(result.data).toHaveLength(2);
    expect(qb.limit).toHaveBeenCalledWith(50);
    expect(qb.offset).toHaveBeenCalledWith(0);
  });

  it('maps money to a 2dp decimal string and resolves the account name', async () => {
    await build(SEED, 2);
    const { data } = await service.list(defaults());
    expect(data[0].amount).toBe('-4.75');
    expect(data[1].amount).toBe('3100.00');
    expect(data[0].account).toBe('Checking');
  });

  it('omits category/bucket when absent (DA-6)', async () => {
    await build(SEED, 2);
    const { data } = await service.list(defaults());
    expect(data[0].category).toBe('dining');
    expect(data[0].bucket).toBe('wants');
    expect('category' in data[1]).toBe(false);
    expect('bucket' in data[1]).toBe(false);
  });

  it('falls back to empty string when the account name is null', async () => {
    await build([{ ...SEED[0], account: null }], 1);
    const { data } = await service.list(defaults());
    expect(data[0].account).toBe('');
  });

  it('offset past the end -> empty data, correct total (DA-4)', async () => {
    await build([], 2);
    const result = await service.list(
      Object.assign(new TransactionQueryDto(), { limit: 50, offset: 999 }),
    );
    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({ limit: 50, offset: 999, total: 2 });
  });

  it('wires every filter into the query builder', async () => {
    await build(SEED, 2);
    await service.list(
      Object.assign(new TransactionQueryDto(), {
        limit: 50,
        offset: 0,
        date_from: '2026-05-01',
        date_to: '2026-05-31',
        account: 'Checking',
        category: 'dining',
        q: 'coffee',
      }),
    );
    expect(qb.andWhere).toHaveBeenCalledWith('t.date >= :dateFrom', {
      dateFrom: '2026-05-01',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('t.date <= :dateTo', {
      dateTo: '2026-05-31',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('a.name = :account', {
      account: 'Checking',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('t.category = :category', {
      category: 'dining',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('t.description ILIKE :q', {
      q: '%coffee%',
    });
  });

  it('does not add filters that were not supplied', async () => {
    await build(SEED, 2);
    await service.list(defaults());
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('raises canonical 503 when the DB query fails (DA-18)', async () => {
    await build(SEED, 2);
    qb.getCount.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.list(defaults())).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('formatMoney', () => {
  it.each([
    ['-4.75', '-4.75'],
    ['3100.00', '3100.00'],
    ['-15.99', '-15.99'],
    ['12', '12.00'],
    ['12.5', '12.50'],
    ['0.00', '0.00'],
    ['-0.00', '0.00'], // never emit -0.00
    ['100.999', '100.99'], // truncate to 2dp (no float rounding)
  ])('formatMoney(%s) -> %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('passes through a YYYY-MM-DD string', () => {
    expect(formatDate('2026-05-20')).toBe('2026-05-20');
  });

  it('formats a Date object as YYYY-MM-DD', () => {
    expect(formatDate(new Date('2026-05-20T00:00:00Z'))).toBe('2026-05-20');
  });
});
