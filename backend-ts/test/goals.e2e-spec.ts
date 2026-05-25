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
  RecurringChargeEntity,
  GoalEntity,
  TransactionEntity,
} from '../src/entities/entities';
import { CanonicalExceptionFilter } from '../src/errors/canonical-exception.filter';
import { canonicalValidationExceptionFactory } from '../src/errors/validation-exception.factory';

/**
 * E2E contract for `GET /api/v1/goals` (parity twin of the FastAPI
 * `test_goals.py`). Runs the FULL Nest stack — global `ValidationPipe` +
 * `CanonicalExceptionFilter` — with the `goals` repository and the TypeORM
 * DataSource overridden by fakes, so it needs no live DB.
 *
 * Asserts the same scenarios the parity harness checks cross-backend: the full
 * design §3 response shape (summed money decimal-strings, numeric progress_pct,
 * funding sorted by name, zero-filled affordability) and the canonical 503 on a
 * DB failure (DA-18). Reads the `goals` rows only — no recompute (DA-23).
 */
const GOALS = [
  { id: '1', name: 'Emergency Fund', target: '50000.00', saved: '15000.00' },
  { id: '2', name: 'Vacation', target: '10000.00', saved: '6000.00' },
];

describe('GoalsController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failNext = false;

  const goalRepo = {
    find: jest.fn(() =>
      failNext
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve(GOALS),
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
      .overrideProvider(getRepositoryToken(GoalEntity))
      .useValue(goalRepo)
      .overrideProvider(getRepositoryToken(AccountEntity))
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

  interface GoalsBody {
    target: string;
    saved: string;
    progress_pct: number;
    funding: Array<{ source: string; amount: string }>;
    affordability: Record<string, unknown>;
  }
  interface ErrorBody {
    error: { code: string; message: string; details: unknown[] };
  }

  it('GET /api/v1/goals -> 200 design §3 shape (money string, pct number)', () =>
    request(server)
      .get('/api/v1/goals')
      .expect(200)
      .expect((res) => {
        const body = res.body as GoalsBody;
        expect(Object.keys(body).sort()).toEqual([
          'affordability',
          'funding',
          'progress_pct',
          'saved',
          'target',
        ]);
        // Summed money is a decimal STRING (DA-2); progress is numeric (DA-22).
        expect(body.target).toBe('60000.00');
        expect(body.saved).toBe('21000.00');
        expect(body.progress_pct).toBe(35);
        expect(typeof body.progress_pct).toBe('number');
        // Funding sorted by name; amount is a decimal string.
        expect(body.funding.map((f) => f.source)).toEqual([
          'Emergency Fund',
          'Vacation',
        ]);
        expect(body.funding[0].amount).toBe('15000.00');
        // Affordability is a zero-filled block.
        expect(body.affordability).toEqual({
          price: '0.00',
          down_payment: '0.00',
          mortgage: '0.00',
          monthly_piti: '0.00',
          income_share: 0,
        });
      }));

  it('GET /api/v1/goals with a DB failure -> 503 canonical (DA-18)', () => {
    failNext = true;
    return request(server)
      .get('/api/v1/goals')
      .expect(503)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.error.details).toEqual([]);
      });
  });
});
