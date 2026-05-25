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
- `GET /api/v1/budget` (P4.2) → `200` Budget view composed from the **precomputed** aggregate
  tables (`budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges`):
  `savings_rate`/`effective_tax_rate` (numeric 0–100), 50/30/20 `buckets`, `categories`, `monthly`
  needs/wants, `recurring`. `window` selector (default `12m`); empty DB → zeros + empty arrays.
  Money decimal **string**, percentages numeric, dates `YYYY-MM-DD`. **No recompute** — a thin read
  identical to FastAPI's route (DA-9/DA-23). A `src/budget/` module (controller + query DTO + service
  reading 5 aggregate repositories) backs it.
- `GET /api/v1/networth` (P4.3) → `200` Net Worth view composed from the `accounts` table:
  `assets` = sum of positive balances, `liabilities` = abs of negative (signed-balance convention),
  `net_worth` = their net; `accounts[]` sorted by name with `delta_30d` `"0.00"` and `series` empty —
  the snapshot table holds no balance history, so neither is fabricated (keeps parity). `window`
  accepted for parity; empty DB → zero totals + empty arrays. Money decimal **string**. **No recompute** —
  a thin read identical to FastAPI's route (DA-9/DA-23). Totals are summed in integer cents (never a
  float). A `src/networth/` module (controller + query DTO + service reading the `accounts` repository)
  backs it.
- `GET /api/v1/investments` (P4.4) → `200` Investments view, a thin read of the `holdings` table:
  `portfolio_value`/`unrealized_gain` (summed in integer **cents** so the totals are byte-identical to
  FastAPI's `Decimal` sum), `allocation[]` (by asset class: `actual_pct` = market share, `target_pct` =
  summed per-holding weights, `amount`), `concentration[]` (per-holding market share, ranked desc),
  `holdings[]` (by symbol). Empty DB → `"0.00"` totals + empty arrays. Money decimal **string**,
  percentages numeric 0–100. **No recompute** — identical to FastAPI's route (DA-9/DA-23). A
  `src/investments/` module (controller + service reading the `holdings` repository) backs it.

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
