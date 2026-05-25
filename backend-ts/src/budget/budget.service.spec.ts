import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  RecurringChargeEntity,
} from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { BudgetService, formatPercent } from './budget.service';

/**
 * Unit tests for `BudgetService` (parity twin of the FastAPI `test_budget.py`).
 * Each aggregate repository is faked so we assert the service's behaviour —
 * composition of the precomputed tables, deterministic ordering, money/percent/
 * date mapping, empty-DB zeros/empties, and the canonical 503 on DB failure —
 * without a live DB. No recompute happens here (DA-23).
 */

function repoReturning(rows: unknown): {
  findOne: jest.Mock;
  find: jest.Mock;
} {
  return {
    findOne: jest.fn().mockResolvedValue(Array.isArray(rows) ? rows[0] : rows),
    find: jest.fn().mockResolvedValue(rows),
  };
}

const AGG = {
  window: '12m',
  savingsRate: '22.0',
  effectiveTaxRate: '18.5',
};

// Rows deliberately out of canonical order to exercise the service's sort.
const BUCKETS = [
  {
    window: '12m',
    name: 'savings',
    targetPct: '20.0',
    actualPct: '22.0',
    amount: '1100.00',
  },
  {
    window: '12m',
    name: 'needs',
    targetPct: '50.0',
    actualPct: '48.0',
    amount: '2400.00',
  },
  {
    window: '12m',
    name: 'wants',
    targetPct: '30.0',
    actualPct: '30.0',
    amount: '1500.00',
  },
];

const CATEGORIES = [
  { window: '12m', name: 'groceries', amount: '420.00', bucket: 'needs' },
  { window: '12m', name: 'rent', amount: '1800.00', bucket: 'needs' },
];

const MONTHLY = [
  { window: '12m', month: '2026-02', needs: '2350.00', wants: '1480.00' },
  { window: '12m', month: '2026-03', needs: '2400.00', wants: '1500.00' },
];

const RECURRING = [
  {
    merchant: 'Cloud Backup',
    category: 'software',
    cadence: 'monthly',
    lastCharged: '2026-05-03',
    monthlyEst: '9.00',
  },
  {
    merchant: 'Streaming Co',
    category: 'entertainment',
    cadence: 'monthly',
    lastCharged: '2026-05-01',
    monthlyEst: '15.99',
  },
];

describe('BudgetService', () => {
  async function build(opts: {
    aggregate?: unknown;
    buckets?: unknown[];
    categories?: unknown[];
    monthly?: unknown[];
    recurring?: unknown[];
  }): Promise<{
    service: BudgetService;
    aggRepo: { findOne: jest.Mock; find: jest.Mock };
  }> {
    const aggRepo = {
      findOne: jest.fn().mockResolvedValue(opts.aggregate ?? null),
      find: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        {
          provide: getRepositoryToken(BudgetAggregateEntity),
          useValue: aggRepo,
        },
        {
          provide: getRepositoryToken(BudgetBucketAggregateEntity),
          useValue: repoReturning(opts.buckets ?? []),
        },
        {
          provide: getRepositoryToken(BudgetCategoryAggregateEntity),
          useValue: repoReturning(opts.categories ?? []),
        },
        {
          provide: getRepositoryToken(BudgetMonthlyAggregateEntity),
          useValue: repoReturning(opts.monthly ?? []),
        },
        {
          provide: getRepositoryToken(RecurringChargeEntity),
          useValue: repoReturning(opts.recurring ?? []),
        },
      ],
    }).compile();
    return { service: module.get(BudgetService), aggRepo };
  }

  const seeded = () =>
    build({
      aggregate: AGG,
      buckets: BUCKETS,
      categories: CATEGORIES,
      monthly: MONTHLY,
      recurring: RECURRING,
    });

  it('composes the full design §3 shape', async () => {
    const { service } = await seeded();
    const body = await service.get('12m');
    expect(Object.keys(body).sort()).toEqual([
      'buckets',
      'categories',
      'effective_tax_rate',
      'monthly',
      'recurring',
      'savings_rate',
    ]);
  });

  it('renders rates as numeric percentages (DA-22)', async () => {
    const { service } = await seeded();
    const body = await service.get('12m');
    expect(body.savings_rate).toBe(22);
    expect(body.effective_tax_rate).toBe(18.5);
    expect(typeof body.savings_rate).toBe('number');
  });

  it('orders buckets 50/30/20 with money string + numeric pct', async () => {
    const { service } = await seeded();
    const body = await service.get('12m');
    expect(body.buckets.map((b) => b.name)).toEqual([
      'needs',
      'wants',
      'savings',
    ]);
    expect(body.buckets[0].amount).toBe('2400.00');
    expect(body.buckets[0].target_pct).toBe(50);
    expect(typeof body.buckets[0].amount).toBe('string');
    expect(typeof body.buckets[0].target_pct).toBe('number');
  });

  it('maps categories with money string + bucket', async () => {
    const { service } = await seeded();
    const body = await service.get('12m');
    expect(body.categories[0]).toEqual({
      name: 'groceries',
      amount: '420.00',
      bucket: 'needs',
    });
  });

  it('maps monthly needs/wants as money strings', async () => {
    const { service } = await seeded();
    const body = await service.get('12m');
    expect(body.monthly.map((m) => m.month)).toEqual(['2026-02', '2026-03']);
    expect(body.monthly[0]).toEqual({
      month: '2026-02',
      needs: '2350.00',
      wants: '1480.00',
    });
  });

  it('maps recurring charges with date + money', async () => {
    const { service } = await seeded();
    const body = await service.get('12m');
    const streaming = body.recurring.find(
      (r) => r.merchant === 'Streaming Co',
    )!;
    expect(streaming.last_charged).toBe('2026-05-01');
    expect(streaming.monthly_est).toBe('15.99');
    expect(streaming.cadence).toBe('monthly');
  });

  it('empty DB -> zeros + empty arrays', async () => {
    const { service } = await build({});
    const body = await service.get('12m');
    expect(body).toEqual({
      savings_rate: 0,
      effective_tax_rate: 0,
      buckets: [],
      categories: [],
      monthly: [],
      recurring: [],
    });
  });

  it('scopes the aggregate query by the window selector', async () => {
    const { service, aggRepo } = await seeded();
    await service.get('3m');
    expect(aggRepo.findOne).toHaveBeenCalledWith({ where: { window: '3m' } });
  });

  it('raises canonical 503 when a DB query fails (DA-18)', async () => {
    const { service, aggRepo } = await seeded();
    aggRepo.findOne.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.get('12m')).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('formatPercent', () => {
  it.each([
    ['22.0', 22],
    ['18.5', 18.5],
    ['0', 0],
    ['48.04', 48], // quantize to one decimal
    ['30', 30],
  ])('formatPercent(%s) -> %s', (input, expected) => {
    expect(formatPercent(input)).toBe(expected);
  });
});
