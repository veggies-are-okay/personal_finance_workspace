import type { Server } from 'node:http';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import {
  AccountEntity,
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  GoalEntity,
  PlaidItemEntity,
  SourceConfigEntity,
  HoldingEntity,
  LoanEntity,
  RecurringChargeEntity,
  TransactionEntity,
} from '../src/entities/entities';
import { CanonicalExceptionFilter } from '../src/errors/canonical-exception.filter';
import { canonicalValidationExceptionFactory } from '../src/errors/validation-exception.factory';

/**
 * E2E contract for `GET /api/v1/investments` (parity twin of the FastAPI
 * `test_investments.py`). Runs the FULL Nest stack — global `ValidationPipe` +
 * `CanonicalExceptionFilter` — with the holdings repository + TypeORM DataSource
 * overridden by fakes, so it needs no live DB.
 *
 * Asserts the same scenarios the parity harness checks cross-backend: the full
 * design §3 response shape (money decimal-string, percentages numeric,
 * allocation/concentration derived + ordered) and the canonical 503 on a DB
 * failure (DA-18). Reads the holdings table only — no recompute (DA-23).
 */
// Synthetic portfolio: portfolio = 27000 + 18000 + 5000 = 50000. The fake repo
// returns rows already symbol-sorted (the real query ORDER BY symbol does this).
const HOLDINGS = [
  {
    symbol: 'BND',
    name: 'Total Bond ETF',
    value: '5000.00',
    weight: '20.0',
    gain: '-200.00',
    assetClass: 'bonds',
  },
  {
    symbol: 'VTI',
    name: 'Total Market ETF',
    value: '27000.00',
    weight: '45.0',
    gain: '3600.00',
    assetClass: 'equities',
  },
  {
    symbol: 'VXUS',
    name: 'Total Intl ETF',
    value: '18000.00',
    weight: '35.0',
    gain: '1500.00',
    assetClass: 'equities',
  },
];

describe('InvestmentsController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failNext = false;

  const holdingRepo = {
    find: jest.fn(() =>
      failNext
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve(HOLDINGS),
    ),
  };

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
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetBucketAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetCategoryAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetMonthlyAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(RecurringChargeEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(HoldingEntity))
      .useValue(holdingRepo)
      .overrideProvider(getRepositoryToken(AccountEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(LoanEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(GoalEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(PlaidItemEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(SourceConfigEntity))
      .useValue({})
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

  interface InvestmentsBody {
    portfolio_value: string;
    unrealized_gain: string;
    allocation: Array<Record<string, unknown>>;
    concentration: Array<Record<string, unknown>>;
    holdings: Array<Record<string, unknown>>;
  }
  interface ErrorBody {
    error: { code: string; message: string; details: unknown[] };
  }

  it('GET /api/v1/investments -> 200 design §3 shape (money string, pct number)', () =>
    request(server)
      .get('/api/v1/investments')
      .expect(200)
      .expect((res) => {
        const body = res.body as InvestmentsBody;
        expect(Object.keys(body).sort()).toEqual([
          'allocation',
          'concentration',
          'holdings',
          'portfolio_value',
          'unrealized_gain',
        ]);
        // Money is a decimal string (DA-2).
        expect(body.portfolio_value).toBe('50000.00');
        expect(body.unrealized_gain).toBe('4900.00');
        // Allocation by class with derived target/actual; pct numeric (DA-22).
        expect(body.allocation.map((a) => a.class)).toEqual([
          'bonds',
          'equities',
        ]);
        expect(body.allocation[1].actual_pct).toBe(90);
        expect(body.allocation[1].target_pct).toBe(80);
        expect(typeof body.allocation[1].actual_pct).toBe('number');
        // Concentration ranked by descending market share.
        expect(body.concentration.map((c) => c.holding)).toEqual([
          'VTI',
          'VXUS',
          'BND',
        ]);
        // Holdings by symbol; money string + numeric weight.
        expect(body.holdings.map((h) => h.symbol)).toEqual([
          'BND',
          'VTI',
          'VXUS',
        ]);
        expect(body.holdings[1].value).toBe('27000.00');
        expect(typeof body.holdings[1].weight).toBe('number');
      }));

  it('GET /api/v1/investments with a DB failure -> 503 canonical (DA-18)', () => {
    failNext = true;
    return request(server)
      .get('/api/v1/investments')
      .expect(503)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.error.details).toEqual([]);
      });
  });
});
