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
 * E2E contract for `GET /api/v1/debt` (parity twin of the FastAPI
 * `test_debt.py`). Runs the FULL Nest stack — global `ValidationPipe` +
 * `CanonicalExceptionFilter` — with the `loans` repository and the TypeORM
 * DataSource overridden by fakes, so it needs no live DB.
 *
 * Asserts the same scenarios the parity harness checks cross-backend: the full
 * design §3 response shape (money decimal-string, rate number, enums per
 * registry), BOTH payoff strategies, an out-of-registry `strategy` -> canonical
 * 422 (DA-1), and the canonical 503 on a DB failure (DA-18). Thin read — no
 * recompute (DA-23).
 */
const LOANS = [
  {
    name: 'Loan B',
    balance: '8000.00',
    rate: '4.5',
    minimumPayment: '100.00',
    priority: 'then',
  },
  {
    name: 'Loan A',
    balance: '12000.00',
    rate: '6.8',
    minimumPayment: '150.00',
    priority: 'pay_first',
  },
];

describe('DebtController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failNext = false;

  const loanRepo = {
    find: jest.fn(() =>
      failNext
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve(LOANS),
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
      .overrideProvider(getRepositoryToken(LoanEntity))
      .useValue(loanRepo)
      .overrideProvider(getRepositoryToken(AccountEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(HoldingEntity))
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

  interface DebtBody {
    total: string;
    weighted_avg_rate: number;
    monthly_minimum: string;
    tranches: Array<Record<string, unknown>>;
    payoff: Array<Record<string, unknown>>;
    loans: Array<Record<string, unknown>>;
  }
  interface ErrorBody {
    error: { code: string; message: string; details: unknown[] };
  }

  it('GET /api/v1/debt -> 200 design §3 shape (money string, rate number, enums)', () =>
    request(server)
      .get('/api/v1/debt')
      .expect(200)
      .expect((res) => {
        const body = res.body as DebtBody;
        expect(Object.keys(body).sort()).toEqual([
          'loans',
          'monthly_minimum',
          'payoff',
          'total',
          'tranches',
          'weighted_avg_rate',
        ]);
        expect(body.total).toBe('20000.00');
        expect(typeof body.total).toBe('string');
        expect(typeof body.weighted_avg_rate).toBe('number');
        // Loans ordered by rate desc; priority is a registry enum string.
        expect(body.loans.map((l) => l.name)).toEqual(['Loan A', 'Loan B']);
        expect(body.loans[0].priority).toBe('pay_first');
        // Both payoff strategies, avalanche first.
        expect(body.payoff.map((p) => p.strategy)).toEqual([
          'avalanche',
          'minimums',
        ]);
      }));

  it('accepts a known strategy without changing the body', () =>
    request(server).get('/api/v1/debt?strategy=avalanche').expect(200));

  it('GET /api/v1/debt?strategy=snowball -> 422 canonical envelope (DA-1)', () =>
    request(server)
      .get('/api/v1/debt?strategy=snowball')
      .expect(422)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(
          body.error.details.some(
            (d) => (d as { field: string }).field === 'strategy',
          ),
        ).toBe(true);
      }));

  it('GET /api/v1/debt with a DB failure -> 503 canonical (DA-18)', () => {
    failNext = true;
    return request(server)
      .get('/api/v1/debt')
      .expect(503)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.error.details).toEqual([]);
      });
  });
});
