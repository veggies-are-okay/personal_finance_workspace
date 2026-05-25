import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { TransactionQueryDto } from './transaction-query.dto';
import {
  PaginatedTransactionsDto,
  PaginationDto,
  TransactionDto,
} from './transaction-response.dto';

/** Validate the query DTO directly (mirrors the FastAPI 422 cases). */
function check(raw: Record<string, unknown>) {
  const dto = plainToInstance(TransactionQueryDto, raw, {
    enableImplicitConversion: false,
  });
  return validateSync(dto);
}

describe('TransactionQueryDto', () => {
  it('accepts an empty query (defaults applied)', () => {
    const dto = plainToInstance(TransactionQueryDto, {});
    expect(dto.limit).toBe(50);
    expect(dto.offset).toBe(0);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts a valid full query', () => {
    expect(
      check({
        limit: '25',
        offset: '10',
        date_from: '2026-05-01',
        date_to: '2026-05-31',
        account: 'Checking',
        category: 'dining',
        q: 'coffee',
      }),
    ).toHaveLength(0);
  });

  it('rejects limit > 200', () => {
    const errors = check({ limit: '201' });
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
    expect(Object.keys(errors[0].constraints ?? {})).toContain('max');
  });

  it('rejects limit < 1', () => {
    expect(check({ limit: '0' }).some((e) => e.property === 'limit')).toBe(
      true,
    );
  });

  it('rejects a negative offset', () => {
    expect(check({ offset: '-1' }).some((e) => e.property === 'offset')).toBe(
      true,
    );
  });

  it('rejects a non-integer limit', () => {
    expect(check({ limit: 'abc' }).some((e) => e.property === 'limit')).toBe(
      true,
    );
  });

  it('rejects a malformed date_from', () => {
    const errors = check({ date_from: 'not-a-date' });
    expect(errors.some((e) => e.property === 'date_from')).toBe(true);
  });

  it('rejects a malformed date_to', () => {
    expect(
      check({ date_to: '05-2026' }).some((e) => e.property === 'date_to'),
    ).toBe(true);
  });
});

describe('response DTOs', () => {
  it('construct with the canonical wire shape', () => {
    const tx = new TransactionDto();
    tx.date = '2026-05-20';
    tx.account = 'Checking';
    tx.description = 'Coffee Shop';
    tx.category = 'dining';
    tx.bucket = 'wants';
    tx.amount = '-4.75';
    tx.is_recurring = false;

    const pagination = new PaginationDto();
    pagination.limit = 50;
    pagination.offset = 0;
    pagination.total = 1;

    const page = new PaginatedTransactionsDto();
    page.data = [tx];
    page.pagination = pagination;

    expect(page.data[0].amount).toBe('-4.75');
    expect(page.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
  });
});
