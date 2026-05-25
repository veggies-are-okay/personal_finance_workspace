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
 * E2E contract for `GET /api/v1/networth` (parity twin of the FastAPI
 * `test_networth.py`). Runs the FULL Nest stack — global `ValidationPipe` +
 * `CanonicalExceptionFilter` — with the `accounts` repository and the TypeORM
 * DataSource overridden by fakes, so it needs no live DB.
 *
 * Asserts the same scenarios the parity harness checks cross-backend: the full
 * design §3 response shape (totals as money decimal-strings via the
 * signed-balance convention, accounts in name order, `delta_30d` "0.00", empty
 * `series`) and the canonical 503 on a DB failure (DA-18). Thin read only — no
 * recompute (DA-23).
 */
const ACCOUNTS = [
  { id: '1', name: 'Brokerage', type: 'investment', balance: '60000.00' },
  { id: '2', name: 'Checking', type: 'depository', balance: '28900.00' },
  { id: '3', name: 'Roth IRA', type: 'retirement', balance: '90000.00' },
  { id: '4', name: 'Unfunded', type: 'depository', balance: null },
  { id: '5', name: 'Visa', type: 'credit', balance: '-26560.00' },
];

describe('NetWorthController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failNext = false;

  const accountRepo = {
    find: jest.fn(() =>
      failNext
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve(ACCOUNTS),
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
      .overrideProvider(getRepositoryToken(AccountEntity))
      .useValue(accountRepo)
      .overrideProvider(getRepositoryToken(HoldingEntity))
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

  interface NetWorthBody {
    net_worth: string;
    assets: string;
    liabilities: string;
    series: unknown[];
    accounts: Array<Record<string, unknown>>;
  }
  interface ErrorBody {
    error: { code: string; message: string; details: unknown[] };
  }

  it('GET /api/v1/networth -> 200 design §3 shape (signed-balance totals)', () =>
    request(server)
      .get('/api/v1/networth')
      .expect(200)
      .expect((res) => {
        const body = res.body as NetWorthBody;
        expect(Object.keys(body).sort()).toEqual([
          'accounts',
          'assets',
          'liabilities',
          'net_worth',
          'series',
        ]);
        // Money totals are decimal STRINGS (DA-2) via the signed convention.
        expect(body.assets).toBe('178900.00');
        expect(body.liabilities).toBe('26560.00');
        expect(body.net_worth).toBe('152340.00');
        // Accounts in name order; null balance -> "0.00"; delta_30d zero.
        expect(body.accounts.map((a) => a.name)).toEqual([
          'Brokerage',
          'Checking',
          'Roth IRA',
          'Unfunded',
          'Visa',
        ]);
        expect(body.accounts[0].balance).toBe('60000.00');
        expect(body.accounts[0].delta_30d).toBe('0.00');
        // No history source -> empty series.
        expect(body.series).toEqual([]);
      }));

  it('GET /api/v1/networth with a DB failure -> 503 canonical (DA-18)', () => {
    failNext = true;
    return request(server)
      .get('/api/v1/networth')
      .expect(503)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.error.details).toEqual([]);
      });
  });
});
