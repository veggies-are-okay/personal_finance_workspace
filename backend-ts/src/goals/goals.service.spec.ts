import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { GoalEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { GoalsService, toCents, centsToString } from './goals.service';

/**
 * Unit tests for `GoalsService` (parity twin of the FastAPI `test_goals.py`).
 * The `goals` repository is faked so we assert the service's behaviour — summing
 * target/saved, the overall progress ratio, deterministic name ordering of
 * funding, money decimal-strings, the zero-filled affordability block, empty-DB
 * zeros, and the canonical 503 on DB failure — without a live DB. No recompute
 * happens here (DA-23).
 */

// Rows as the DB returns them (already ordered by name, then id) — the
// service relies on the repository's `order` clause, mirrored in the fixture.
const GOALS = [
  { id: '1', name: 'Emergency Fund', target: '50000.00', saved: '15000.00' },
  { id: '2', name: 'Vacation', target: '10000.00', saved: '6000.00' },
];

const ZERO_AFFORDABILITY = {
  price: '0.00',
  down_payment: '0.00',
  mortgage: '0.00',
  monthly_piti: '0.00',
  income_share: 0,
};

describe('GoalsService', () => {
  async function build(rows: unknown[]): Promise<{
    service: GoalsService;
    repo: { find: jest.Mock };
  }> {
    const repo = { find: jest.fn().mockResolvedValue(rows) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: getRepositoryToken(GoalEntity), useValue: repo },
      ],
    }).compile();
    return { service: module.get(GoalsService), repo };
  }

  it('composes the full design §3 shape', async () => {
    const { service } = await build(GOALS);
    const body = await service.get();
    expect(Object.keys(body).sort()).toEqual([
      'affordability',
      'funding',
      'progress_pct',
      'saved',
      'target',
    ]);
  });

  it('sums target/saved as money strings (DA-2)', async () => {
    const { service } = await build(GOALS);
    const body = await service.get();
    expect(body.target).toBe('60000.00');
    expect(body.saved).toBe('21000.00');
    expect(typeof body.target).toBe('string');
  });

  it('derives progress_pct as a numeric percentage (DA-22)', async () => {
    const { service } = await build(GOALS);
    const body = await service.get();
    expect(body.progress_pct).toBe(35);
    expect(typeof body.progress_pct).toBe('number');
  });

  it('orders funding by name with money strings', async () => {
    const { service } = await build(GOALS);
    const body = await service.get();
    expect(body.funding.map((f) => f.source)).toEqual([
      'Emergency Fund',
      'Vacation',
    ]);
    expect(body.funding[0].amount).toBe('15000.00');
    expect(body.funding[1].amount).toBe('6000.00');
    expect(typeof body.funding[0].amount).toBe('string');
  });

  it('serves a zero-filled affordability block', async () => {
    const { service } = await build(GOALS);
    const body = await service.get();
    expect(body.affordability).toEqual(ZERO_AFFORDABILITY);
  });

  it('orders the query by name then id', async () => {
    const { service, repo } = await build(GOALS);
    await service.get();
    expect(repo.find).toHaveBeenCalledWith({
      order: { name: 'ASC', id: 'ASC' },
    });
  });

  it('empty DB -> zeros + empty funding + zero affordability', async () => {
    const { service } = await build([]);
    const body = await service.get();
    expect(body).toEqual({
      target: '0.00',
      saved: '0.00',
      progress_pct: 0,
      funding: [],
      affordability: ZERO_AFFORDABILITY,
    });
  });

  it('raises canonical 503 when the DB query fails (DA-18)', async () => {
    const { service, repo } = await build([]);
    repo.find.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.get()).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('toCents / centsToString', () => {
  it.each([
    ['10000.00', 1000000],
    ['6000.00', 600000],
    ['-4.05', -405],
    ['.15', 15],
    ['0', 0],
    ['0.00', 0],
  ])('toCents(%s) -> %s', (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each([
    [1000000, '10000.00'],
    [-405, '-4.05'],
    [15, '0.15'],
    [0, '0.00'],
  ])('centsToString(%s) -> %s', (input, expected) => {
    expect(centsToString(input)).toBe(expected);
  });
});
