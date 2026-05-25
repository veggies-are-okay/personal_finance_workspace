import type { Server } from 'node:http';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import {
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  RecurringChargeEntity,
  TransactionEntity,
} from '../src/entities/entities';
import { CanonicalExceptionFilter } from '../src/errors/canonical-exception.filter';
import { canonicalValidationExceptionFactory } from '../src/errors/validation-exception.factory';

/**
 * E2E contract for `GET /api/v1/budget` (parity twin of the FastAPI
 * `test_budget.py`). Runs the FULL Nest stack — global `ValidationPipe` +
 * `CanonicalExceptionFilter` — with the aggregate repositories and the TypeORM
 * DataSource overridden by fakes, so it needs no live DB.
 *
 * Asserts the same scenarios the parity harness checks cross-backend: the full
 * design §3 response shape (money decimal-string, percentages numeric, dates
 * YYYY-MM-DD, deterministic ordering) and the canonical 503 on a DB failure
 * (DA-18). Reads precomputed rows only — no recompute (DA-23).
 */
const AGG = { window: '12m', savingsRate: '22.0', effectiveTaxRate: '18.5' };
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
];
const RECURRING = [
  {
    merchant: 'Streaming Co',
    category: 'entertainment',
    cadence: 'monthly',
    lastCharged: '2026-05-01',
    monthlyEst: '15.99',
  },
];

describe('BudgetController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failNext = false;

  const aggRepo = {
    findOne: jest.fn(() =>
      failNext
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve(AGG),
    ),
    find: jest.fn(),
  };
  const bucketRepo = { find: jest.fn().mockResolvedValue(BUCKETS) };
  const categoryRepo = { find: jest.fn().mockResolvedValue([]) };
  const monthlyRepo = { find: jest.fn().mockResolvedValue([]) };
  const recurringRepo = { find: jest.fn().mockResolvedValue(RECURRING) };

  const fakeDataSource: Partial<DataSource> = {
    isInitialized: true,
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .overrideProvider(getRepositoryToken(TransactionEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetAggregateEntity))
      .useValue(aggRepo)
      .overrideProvider(getRepositoryToken(BudgetBucketAggregateEntity))
      .useValue(bucketRepo)
      .overrideProvider(getRepositoryToken(BudgetCategoryAggregateEntity))
      .useValue(categoryRepo)
      .overrideProvider(getRepositoryToken(BudgetMonthlyAggregateEntity))
      .useValue(monthlyRepo)
      .overrideProvider(getRepositoryToken(RecurringChargeEntity))
      .useValue(recurringRepo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new CanonicalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: canonicalValidationExceptionFactory,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    failNext = false;
  });

  interface BudgetBody {
    savings_rate: number;
    effective_tax_rate: number;
    buckets: Array<Record<string, unknown>>;
    categories: unknown[];
    monthly: unknown[];
    recurring: Array<Record<string, unknown>>;
  }
  interface ErrorBody {
    error: { code: string; message: string; details: unknown[] };
  }

  it('GET /api/v1/budget -> 200 design §3 shape (money string, pct number)', () =>
    request(server)
      .get('/api/v1/budget')
      .expect(200)
      .expect((res) => {
        const body = res.body as BudgetBody;
        expect(Object.keys(body).sort()).toEqual([
          'buckets',
          'categories',
          'effective_tax_rate',
          'monthly',
          'recurring',
          'savings_rate',
        ]);
        // Percentages are numbers (DA-22); money is a string (DA-2).
        expect(body.savings_rate).toBe(22);
        expect(body.effective_tax_rate).toBe(18.5);
        // Buckets ordered 50/30/20.
        expect(body.buckets.map((b) => b.name)).toEqual(['needs', 'savings']);
        expect(body.buckets[0].amount).toBe('2400.00');
        expect(typeof body.buckets[0].target_pct).toBe('number');
        // Recurring carries a YYYY-MM-DD date + decimal-string estimate.
        expect(body.recurring[0].last_charged).toBe('2026-05-01');
        expect(body.recurring[0].monthly_est).toBe('15.99');
      }));

  it('GET /api/v1/budget with a DB failure -> 503 canonical (DA-18)', () => {
    failNext = true;
    return request(server)
      .get('/api/v1/budget')
      .expect(503)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.error.details).toEqual([]);
      });
  });
});
