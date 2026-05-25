# backend-ts (NestJS)

NestJS backend for the personal-finance app — the **parity twin** of
`backend-python/` (FastAPI). Both backends expose the same API and must behave
identically (see `.claude/rules/backend-parity.md`).

## Stack

- NestJS 11 (Express), TypeScript (strict)
- `@nestjs/config` — reads the gitignored repo-root `.env` (`DATABASE_URL`, `TS_API_PORT`)
- `@nestjs/swagger` — OpenAPI JSON served at **`/openapi.json`** (mirrors FastAPI), UI at `/docs`
- TypeORM (postgres, `synchronize: false` — Alembic owns the schema; entities in `src/entities/` **mirror** it, P2.3)
- Jest + Supertest (via `@swc/jest`), ESLint + Prettier

## Endpoints

- `GET /health` → `200`, body exactly `{"status":"ok"}`, `content-type: application/json`.
  DB-independent and byte-identical to FastAPI's `/health`.
- `GET /api/v1/transactions` (P4.1) → `200` `Paginated<T>` envelope
  (`{data,pagination{limit,offset,total}}`). Filters: `date_from`/`date_to`/`account`/`category`/`q`;
  `limit` 1–200 (default 50), `offset` ≥ 0. Money is a decimal **string**, dates `YYYY-MM-DD`,
  absent optional fields omitted. Identical to FastAPI's route. A `src/transactions/` module
  (controller + query DTO + service via TypeORM) backs it.

## Errors (canonical envelope — parity with FastAPI)

- `src/errors/` — the canonical `{"error":{code,message,details[]}}` envelope (DA-1). The global
  `ValidationPipe` uses `canonicalValidationExceptionFactory` to emit **HTTP 422** (overriding the
  NestJS default 400), and `CanonicalExceptionFilter` renders every error in that one shape;
  unknown/DB errors degrade to a canonical **503** (DA-18) matching FastAPI.

## Persistence (entities mirror the Alembic schema)

- `src/entities/entities.ts` — TypeORM entities (`@Entity`/`@Column`/`@Check`) that **mirror** the Alembic-owned schema 1:1 (P2.3): accounts, transactions (+enrichment), categories, budgets, loans, goals, holdings, the budget precompute tables + `recurring_charges`, the P3.2 `paystubs` income table (`PaystubEntity`), `plaid_items` (`access_token` `bytea`), `source_config`. `synchronize: false` — TypeORM never alters the schema. Registered via `ALL_ENTITIES` in `app.module.ts`. **Read-only mirror:** the `paystubs` precompute analytics run in Python only (`backend-python/app/precompute/`); this backend never recomputes (DA-9).
- `src/entities/schema-export.ts` — builds TypeORM metadata **without a DB connection** and prints a normalized schema snapshot (`node dist/entities/schema-export.js`). The `contracts/` schema-parity check (DA-8) deep-compares it against the Python snapshot so the entities can never drift from the Alembic head.
- Column types match Appendix A: money `numeric(14,2)`, percentages bare `numeric`, datetimes `timestamptz`, enums `text` + `@Check`, Plaid token `bytea`.
- `app.module.ts` uses a **resilient `dataSourceFactory`** (+ `manualInitialization`): if Postgres is down at boot the app still starts (DB-independent `/health` stays up, mirroring FastAPI's lazy engine), and a DB-backed request then fails into the canonical **503** (DA-18).

## Commands (run from `backend-ts/`)

```bash
npm install
npm run start:dev      # watch mode; serves on TS_API_PORT (default 3000)
npm run build          # tsc build → dist/
npm run lint           # eslint
npm run format:check   # prettier --check
npm run test:cov       # jest + coverage (global floor ≥ 80%)
npm run test:e2e       # Supertest e2e (boots without a live DB)
```

## Quality gate

```bash
npm run lint && npm run format:check && npm run test:cov
```

Coverage floor is **≥ 80%** global (statements/branches/functions/lines),
mirroring the Python gate.
