---
paths:
  - "backend-ts/**/*.ts"
---

# Testing — TypeScript / NestJS (red-green-refactor, 80% coverage)

## Philosophy

1. **Red**: Write a failing test for the desired behavior.
2. **Green**: Implement the minimal code to make the test pass.
3. **Refactor**: Clean up without changing behavior; re-run tests.

- Test **behavior and contracts**, not incidental implementation details.
- Every feature or fix must **change tests** or explicitly document why none are needed.
- Run `npm run test` (and coverage) before considering work done.

---

## Test taxonomy (this repo)

| Scope | What it covers | Where it runs |
|-------|----------------|---------------|
| **Unit** | Services, providers, pure helpers, DTO validation, Decimal/money arithmetic | `npm run test` (Jest, mocked repositories and HTTP clients) |
| **Integration** | Module wiring, database repositories with a transactional test DB or in-memory store | `npm run test` (Jest, mocks or disposable test DB) |
| **E2E** | Controllers end-to-end via Supertest against the full Nest app | `npm run test:e2e` |
| **Contract** | Cross-backend parity — both backends return identical responses for the same request | `contracts/` (run separately; see below) |

- **Unit tests must never call a real database or network.** Mock repository and HTTP-client boundaries at the use-site.
- E2E tests exercise real Nest route wiring and class-validator `ValidationPipe`; they do not require a live DB (override the database provider with a fake/in-memory repo).

---

## Parity with the Python backend

The NestJS backend implements the same API surface as the Python/FastAPI backend. Tests must cover the **same scenarios** across both:

| Scenario | Python (pytest) | TypeScript (Jest/Supertest) |
|----------|----------------|-----------------------------|
| Success (200) | `assert r.status_code == 200` | `expect(res.statusCode).toBe(200)` |
| Validation failure (400/422) | `assert r.status_code == 422` | `expect(res.statusCode).toBe(400)` |
| Not found (404) | `assert r.status_code == 404` | `expect(res.statusCode).toBe(404)` |
| Money value exact | `assert amount == Decimal("45.09")` | `expect(amount).toBe("45.09")` (string) or use a Decimal lib |

**Cross-backend contract tests** live in `contracts/` and assert both backends return identical response shapes and values for the same request. Do not duplicate contract tests inside each backend's own suite.

---

## Synthetic fixtures — never use real financial data

**Never commit or use real bank/credit-card data in tests.** All fixtures must be synthetic:

- Fabricate realistic but entirely fictional merchants, amounts, and dates.
- Store shared fixtures under `tests/fixtures/` (JSON, CSV, or TypeScript objects).
- The key invariant for any parsed data: the sum of parsed transaction amounts must equal the statement's declared total.

```typescript
// Good: invariant assertion on synthetic fixture data
it('parsed amounts sum to statement total', () => {
  const { transactions, summaryTotal } = parseStatement(syntheticStatementFixture);
  const extracted = transactions.reduce((acc, t) => acc + parseFloat(t.amount), 0);
  expect(extracted).toBeCloseTo(parseFloat(summaryTotal), 2);
});
```

> For monetary values stored as strings or a Decimal library, prefer exact string/Decimal comparison over `toBeCloseTo`.

---

## Coverage

- **Hard floor:** 80% across `backend-ts/src/` — enforced by `jest --coverage --coverageThreshold` in `jest.config.ts`.
- **Practical ideal:** Changed modules should usually reach **90%+**.
- Require explicit tests for **success**, **validation-failure**, and **not-found** paths for every controller action and service method.

**Commands:**

```bash
npm run test              # unit + integration (Jest)
npm run test:cov          # with coverage report; fails below 80%
npm run test:e2e          # Supertest e2e suite
```

---

## Money values

Represent monetary values as strings (`"45.09"`) or a Decimal library (e.g. `decimal.js`) — never native `number` for money. Compare exactly:

```typescript
// Correct — string comparison
expect(transaction.amount).toBe("45.09");

// Correct — decimal library
expect(new Decimal(transaction.amount).equals(new Decimal("45.09"))).toBe(true);

// Wrong — floating-point number
expect(transaction.amount).toBeCloseTo(45.09); // do not do this for money
```

---

## Unit tests: services and providers

Use `Test.createTestingModule` with mock repositories and providers. Mock **only true boundaries** (database repositories, external HTTP clients). Exercise real service logic, DTO transforms, and business rules.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TransactionService } from './transaction.service';
import { TransactionRepository } from './transaction.repository';

const mockTransactionRepo = {
  findByAccountId: jest.fn(),
  save: jest.fn(),
};

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: TransactionRepository, useValue: mockTransactionRepo },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
    jest.clearAllMocks();
  });

  it('returns transactions for a valid account', async () => {
    mockTransactionRepo.findByAccountId.mockResolvedValue([
      { date: '2025-01-15', description: 'WHOLE FOODS', amount: '42.00' },
    ]);
    const result = await service.getByAccount('acc-1');
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe('42.00');
  });

  it('throws NotFoundException when account does not exist', async () => {
    mockTransactionRepo.findByAccountId.mockResolvedValue(null);
    await expect(service.getByAccount('missing')).rejects.toThrow(NotFoundException);
  });
});
```

---

## E2E tests: controllers via Supertest

Test the full Nest app — real routing, real `ValidationPipe`, real guards — but replace repository/DB providers with fakes. Assert HTTP status, response body shape, and class-validator 400s.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TransactionRepository } from '../src/transactions/transaction.repository';

const fakeRepo = {
  findByAccountId: jest.fn().mockResolvedValue([
    { date: '2025-01-15', description: 'PHILOMENAPIZZA', amount: '45.09' },
  ]),
  save: jest.fn(),
};

describe('TransactionsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TransactionRepository)
      .useValue(fakeRepo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /transactions?accountId=acc-1 → 200 with array body', () =>
    request(app.getHttpServer())
      .get('/transactions')
      .query({ accountId: 'acc-1' })
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toMatchObject({ description: expect.any(String), amount: expect.any(String) });
      }));

  it('GET /transactions with empty accountId → 400 (ValidationPipe)', () =>
    request(app.getHttpServer())
      .get('/transactions')
      .query({ accountId: '' })
      .expect(400));

  it('GET /transactions for unknown account → 404', () => {
    fakeRepo.findByAccountId.mockResolvedValueOnce(null);
    return request(app.getHttpServer())
      .get('/transactions')
      .query({ accountId: 'no-such-account' })
      .expect(404);
  });
});
```

---

## Mocking patterns

### Where to mock

Mock **repository interfaces** and **external HTTP providers** — not internal service logic. Use `overrideProvider` in `Test.createTestingModule` for module-level swaps.

### Prefer `jest.fn()` with explicit return values

```typescript
const mockHttpClient = {
  get: jest.fn().mockResolvedValue({ data: { rate: 1.35 }, status: 200 }),
};
```

### Simulate failure paths with `mockRejectedValueOnce`

```typescript
it('falls back gracefully on network timeout', async () => {
  mockHttpClient.get
    .mockRejectedValueOnce(new Error('ETIMEDOUT'))
    .mockResolvedValueOnce({ data: { rate: 1.35 }, status: 200 });

  const rate = await service.getExchangeRate('USD', 'CAD');
  expect(rate).toBe('1.35');
  expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
});
```

### Environment variables

Use `process.env` overrides scoped to each test or `beforeEach`/`afterEach` with cleanup:

```typescript
const OLD_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...OLD_ENV, DATABASE_URL: 'postgres://test/testdb' };
});

afterEach(() => {
  process.env = OLD_ENV;
});
```

---

## DTO validation tests

Test class-validator decorators directly — no HTTP layer needed:

```typescript
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

it('rejects missing accountId', async () => {
  const dto = Object.assign(new CreateTransactionDto(), { amount: '45.09' });
  const errors = await validate(dto);
  expect(errors.some((e) => e.property === 'accountId')).toBe(true);
});

it('rejects non-numeric amount', async () => {
  const dto = Object.assign(new CreateTransactionDto(), { accountId: 'acc-1', amount: 'abc' });
  const errors = await validate(dto);
  expect(errors.some((e) => e.property === 'amount')).toBe(true);
});
```

---

## Parametrize with `it.each`

Use `it.each` for multiple input/output scenarios (mirrors Python's `@pytest.mark.parametrize`):

```typescript
it.each([
  ['45.09', true],
  ['.15', true],
  ['-12.00', true],
  ['abc', false],
  ['', false],
])('isValidAmount("%s") → %s', (input, expected) => {
  expect(isValidAmount(input)).toBe(expected);
});
```

---

## Don't over-mock

- Do **not** mock internal helper functions or utility modules — test them through the service.
- Do **not** mock DTOs or class-validator — let `ValidationPipe` run in e2e tests.
- Do **not** mock the Nest DI container itself; use `Test.createTestingModule`.

---

## Cross-backend contract tests

Contract tests live in `contracts/` at the repo root and are run separately from each backend's own test suite. They spin up both backends (or use recorded fixtures) and assert identical response schemas and values. Do not duplicate this logic inside `backend-ts/` tests.

---

## Sniff-testing: slow or unmocked tests

If a unit test is slow, check for accidental I/O:

```bash
npm run test -- --verbose 2>&1 | grep -E "SLOW|ms\)"
```

Add a Jest `testTimeout` in `jest.config.ts` (e.g. `testTimeout: 5000`) to catch runaway tests early.

---

## Layout

```
backend-ts/
  src/
    transactions/
      transaction.service.ts
      transaction.service.spec.ts    ← unit test alongside source
      transaction.controller.ts
  test/
    transactions.e2e-spec.ts         ← e2e tests in /test
  tests/
    fixtures/                        ← synthetic JSON/CSV fixtures (no real data)
```

- Unit tests (`.spec.ts`) live alongside source files.
- E2E tests (`*.e2e-spec.ts`) live in `test/`.
- Shared fixtures live in `tests/fixtures/`.

---

## References

- NestJS testing: https://docs.nestjs.com/fundamentals/testing
- Jest: https://jestjs.io/docs/getting-started
- Supertest: https://github.com/ladjs/supertest
- class-validator: https://github.com/typestack/class-validator
