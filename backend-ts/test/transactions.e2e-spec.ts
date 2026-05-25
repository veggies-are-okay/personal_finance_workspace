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
  HoldingEntity,
  RecurringChargeEntity,
  TransactionEntity,
} from '../src/entities/entities';
import { CanonicalExceptionFilter } from '../src/errors/canonical-exception.filter';
import { canonicalValidationExceptionFactory } from '../src/errors/validation-exception.factory';

/**
 * E2E contract for `GET /api/v1/transactions` (parity twin of the FastAPI
 * `test_transactions.py`). Runs the FULL Nest stack — global `ValidationPipe`
 * (422) + `CanonicalExceptionFilter` — with the `transactions` repository and
 * the TypeORM DataSource overridden by fakes, so it needs no live DB.
 *
 * Asserts the same scenarios the parity harness checks cross-backend: success
 * envelope (money decimal-string, dates YYYY-MM-DD, absent optionals omitted),
 * canonical 422 on a bad query (DA-1), and canonical 503 on a DB failure (DA-18).
 */
const SEED = [
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

function makeQueryBuilder(rows: unknown[], count: number, fail = false) {
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getCount: fail
      ? jest.fn().mockRejectedValue(new Error('connection refused'))
      : jest.fn().mockResolvedValue(count),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

describe('TransactionsController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let failNext = false;

  const repo = {
    createQueryBuilder: jest.fn(() => makeQueryBuilder(SEED, 2, failNext)),
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
      .useValue(repo)
      // Budget feature repos must resolve for AppModule to compile DB-free.
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
      .useValue({})
      .overrideProvider(getRepositoryToken(HoldingEntity))
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

  interface PaginatedBody {
    data: Array<Record<string, unknown>>;
    pagination: { limit: number; offset: number; total: number };
  }
  interface ErrorBody {
    error: {
      code: string;
      message: string;
      details: Array<{ field: string; location: string }>;
    };
  }

  it('GET /api/v1/transactions -> 200 paginated envelope', () =>
    request(server)
      .get('/api/v1/transactions')
      .expect(200)
      .expect((res) => {
        const body = res.body as PaginatedBody;
        expect(Object.keys(body).sort()).toEqual(['data', 'pagination']);
        expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 2 });
        expect(body.data[0].amount).toBe('-4.75');
        // Absent optionals omitted (DA-6).
        expect('category' in body.data[1]).toBe(false);
      }));

  it('GET /api/v1/transactions?limit=201 -> 422 canonical envelope (DA-1)', () =>
    request(server)
      .get('/api/v1/transactions')
      .query({ limit: 201 })
      .expect(422)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(body.error.message).toBe('Request validation failed.');
        expect(body.error.details[0].field).toBe('limit');
        expect(body.error.details[0].location).toBe('query');
      }));

  it('GET /api/v1/transactions?offset=-1 -> 422', () =>
    request(server)
      .get('/api/v1/transactions')
      .query({ offset: -1 })
      .expect(422)
      .expect((res) => {
        expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      }));

  it('GET /api/v1/transactions with a DB failure -> 503 canonical (DA-18)', () => {
    failNext = true;
    return request(server)
      .get('/api/v1/transactions')
      .expect(503)
      .expect((res) => {
        const body = res.body as ErrorBody;
        expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(body.error.details).toEqual([]);
      });
  });
});
