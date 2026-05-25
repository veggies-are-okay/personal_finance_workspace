# Repository Structure

> CHANGELOG
> - 2026-05-24: Initial structure. Foundation skeleton, rule/skill libraries, ingestion utilities. — Foundation pass.
> - 2026-05-24: Added `scripts/ledger.py` (multi-source normalizers + combined loader) and `tests/fixtures/` (synthetic CSV fixtures). — P0.3.
> - 2026-05-24: Added `docs/setup.md` (local Postgres bring-up via docker-compose). — P1.1.
> - 2026-05-24: Scaffolded `backend-python/app/` (FastAPI app, settings, DB wiring, `/health`) + Alembic (`backend-python/alembic/`). — P1.2.
> - 2026-05-24: Scaffolded `backend-ts/` (NestJS parity twin: `@nestjs/config`, global `ValidationPipe`, `@nestjs/swagger` OpenAPI at `/openapi.json`, TypeORM `synchronize: false`, `GET /health` → `{"status":"ok"}`). — P1.3.
> - 2026-05-24: Built the cross-backend **parity harness** in `contracts/` (Vitest): `npm run test:parity` boots BOTH backends (FastAPI :8765, NestJS :3765 — never :8000), polls `/health` for the real `{"status":"ok"}` body, asserts response parity + structural OpenAPI parity for `/health` against a canonical contract, then tears both down. — P1.4.
> - 2026-05-24: Scaffolded the **frontend** (`frontend/`): Vite 8 + React 19 + TypeScript (strict) with Tailwind v4 via the `@tailwindcss/vite` plugin (`@import "tailwindcss"` in `src/index.css`). Backend-NEUTRAL: single network boundary `src/lib/api.ts` reads `VITE_API_BASE_URL` (default `http://localhost:8000`) and `getHealth()` GETs `/health`; `src/features/health/HealthStatus.tsx` renders explicit loading/success/error states and shows the active base URL. Vitest (jsdom + RTL, ≥80% coverage, entry/config excluded); scripts `dev`/`build`/`lint`/`test`. — P1.5.
> - 2026-05-24: Authored the **complete + frozen canonical OpenAPI** in `contracts/openapi.canonical.json` (all view/source/connections paths + `/health`) with Appendix A baked in as reusable components (Money decimal-string, Percentage number, Error envelope → 422, Pagination, enum registry). Added `redocly lint` (`redocly.yaml` + `lint:openapi` script — clean) and a `prism` **mock** (`mock` script). Extended the parity harness: `src/contract.ts` (canonical loader + `IMPLEMENTED_PATHS` allowlist), the structural-diff now scoped to implemented paths (pending = skipped), and per-endpoint value-parity stubs (`endpoints.parity.stubs.test.ts`, `it.todo`) for later branches to fill. `/health` parity stays green. — P2.2.

> - 2026-05-24: Added the **PR rule** (`.claude/rules/pull-requests.md`: README upkeep + file-count-tiered PR descriptions + happy-path verification) and a **README in every first-level dir** — top-level `README.md` plus `frontend/`, `backend-python/`, `scripts/`, `tests/`, `config/`, `docs/`, `plans/` (`backend-ts/` and `contracts/` already had theirs). — PR-rule + READMEs.

> - 2026-05-24: Enforced "every PR via `branch-finalization`": added a `PreToolUse(Bash)` hook (`.claude/hooks/pr-create-reminder.sh` + committed `.claude/settings.json`) that reminds on `gh pr create`; the PR rule + both checklist runner skills now mandate the CI-gated PR flow (no local merge to protected `main`). — Enforce PR flow.

> - 2026-05-24: **DB schema & Item store** (P2.3). Added the canonical schema as SQLAlchemy 2.0 models (`backend-python/app/models.py`) + one Alembic migration (`alembic/versions/f0bda61fcf45_*`): accounts, transactions (+enrichment), categories, budgets, loans, goals, holdings, the budget precompute tables (`budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges`, covering every `/budget` field — DA-23), `plaid_items` (token `BYTEA` ciphertext — DA-12), `source_config`. Types per Appendix A (money `NUMERIC(14,2)`, percentages bare `NUMERIC`, datetimes `timestamptz`, enums `TEXT`+`CHECK`, token `BYTEA`). Mirrored as TypeORM entities (`backend-ts/src/entities/entities.ts`, `synchronize:false`, registered via `ALL_ENTITIES`). Added a **cross-backend schema-parity check** (DA-8): each backend exports a normalized snapshot (`app/schema_export.py`, `src/entities/schema-export.ts`) and `contracts/test/schema.parity.test.ts` (+ `src/schema.ts`) deep-compares them under `npm run test:parity`. — P2.3.

> - 2026-05-24: **Ingestion → DB loader** (P3.1). Added `backend-python/app/ingestion/loader.py`: an idempotent loader that upserts the normalized signed-amount ledger into `transactions` on the unique `dedupe_key` = `sha256(account, date, signed_amount, normalized_description)` (DA-19) — re-import is an upsert, not a duplicate; money is `Decimal`. The DB-writing loader lives in `backend-python/` (under the `python-backend` CI gate); the raw→normalized-CSV normalizers stay in `scripts/`. Integration tests (`tests/test_loader.py`) run against the live Postgres service. — P3.1.

> - 2026-05-24: Added `scripts/evidence_term_shot.sh` (renders terminal output → PNG via the Playwright CLI) and standardized PR happy-path **screenshots** + full **inline** PR bodies (`gh pr create --body-file`). — PR evidence.

> - 2026-05-24: **Precompute deterministic analytics** (P3.2). Added the `paystubs` income table — SQLAlchemy model (`backend-python/app/models.py`) + Alembic migration (`alembic/versions/ba4cb087cce7_*`) + mirrored TypeORM entity (`backend-ts/src/entities/entities.ts`, `PaystubEntity`); the schema-parity check + snapshots updated so `contracts/` stays green (DA-8). Added an idempotent income loader (`backend-python/app/ingestion/income_loader.py`, upsert on `sha256(employer, pay_date, gross_pay, net_pay)` — DA-19) and the **Python-only** precompute package (`backend-python/app/precompute/`: `categorize`, `rates`, `recurring`, `pipeline`) that reads `transactions` + `paystubs` → generic categorization + transfer/recurring detection + 50/30/20 buckets + savings/effective-tax rates (numeric 0–100, DA-22) and writes `budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges` (every `/budget` field — DA-23). Golden-fixture tests assert exact aggregate values + determinism across runs (DA-9); both backends only READ these tables. — P3.2.

> - 2026-05-24: **`GET /api/v1/transactions`** (P4.1) — the first real view endpoint, in **both** backends at parity. Python: `app/routers/transactions.py` (Pydantic query/response models, LEFT JOIN `accounts`, date/account/category/`q` filters, offset/limit `Paginated<T>` envelope) + `app/errors.py` (canonical error envelope; `RequestValidationError`→**422**, `ServiceUnavailableError`→**503**). TS: `src/transactions/` (controller + query DTO + TypeORM service) + `src/errors/` (global `CanonicalExceptionFilter` + `ValidationPipe` `exceptionFactory`→422); `app.module.ts` gained a resilient `dataSourceFactory` so a DB-down boot still serves `/health` and 503s DB routes (DA-18). Established reusable patterns: money decimal-string, dates `YYYY-MM-DD`, omit-absent (DA-6), canonical 422 (DA-1) / 503 (DA-18). Contracts: `test/transactions.parity.test.ts` (success / 422 / offset-past-end / DB-down 503) + `src/db.ts` (synthetic seed) + `startDbDownBackends`; `IMPLEMENTED_PATHS` now includes the path so the structural OpenAPI diff covers it. — P4.1.
> - 2026-05-24: **`GET /api/v1/budget`** (P4.2) — the Budget view in **both** backends at parity, a **thin read** of the precomputed aggregate tables (`budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges`) — **no recompute** in either backend (DA-23). Python: `app/routers/budget.py` + `Budget`/`BudgetBucket`/`BudgetCategory`/`MonthlyNeedsWants`/`RecurringChargeOut` Pydantic models in `app/schemas.py` (money decimal-string, percentages numeric 0–100 via `field_serializer`). TS: `src/budget/` (controller + query DTO + service reading 5 aggregate repos; `formatPercent` numeric helper, reuses `formatMoney`/`formatDate`). `window` selector (default `12m`); deterministic ordering (50/30/20 buckets, categories/monthly/recurring sorted); empty DB → zeros + empty arrays. Contracts: `test/budget.parity.test.ts` (cross-backend identity DA-9 / unknown-window-empty / DB-down 503) + `seedBudgetFixture`/`cleanupBudgetFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` now includes the path (structural OpenAPI diff clean). — P4.2.
> - 2026-05-24: **`GET /api/v1/goals`** (P4.6) — the Goals view in **both** backends at parity, a **thin read** of the `goals` table — **no recompute** in either backend (DA-23). Composition (deterministic, from the `goals` rows): `target`/`saved` = sums (money decimal-string), `progress_pct` = overall ratio `saved/target*100` (numeric 0–100, DA-22), `funding[]` = one `{source,amount}` per goal sorted by name, `affordability{}` = a zero-filled block (the P2.3 schema has no affordability table; neither backend fabricates data). Python: `app/routers/goals.py` + `Goals`/`GoalFunding`/`Affordability` Pydantic models in `app/schemas.py`. TS: `src/goals/` (controller + service reading the `goals` repo; totals summed in integer cents — never a float — `toCents`/`centsToString` helpers). Empty DB → `"0.00"`/`0`/empty funding/zero affordability; DB-down → canonical 503 (DA-18). Contracts: `test/goals.parity.test.ts` (cross-backend identity DA-9 / empty-DB / DB-down 503) + `seedGoalsFixture`/`cleanupGoalsFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` now includes the path (structural OpenAPI diff clean). — P4.6.

Canonical source of truth for the repo layout. **Update this on every merge that adds/removes top-level dirs or key files** (same discipline as README — see `.claude/rules/structure-on-merge.md`).

## Top-level

```
personal_finance/
├── CLAUDE.md                  # Agent guidance (full briefing)
├── docker-compose.yml         # Shared Postgres
├── .env.example               # Env template (copy to .env; gitignored)
├── pyproject.toml             # ROOT uv project: data-prep utilities (scripts/ + tests/)
│
├── frontend/                  # React 19 + Vite 8 + Tailwind v4 (TS, strict) — backend-neutral via VITE_API_BASE_URL
│   ├── src/                   #   main.tsx (entry) · App.tsx (page shell) · index.css (@import "tailwindcss")
│   │   ├── lib/               #     api.ts — single network boundary: apiBaseUrl + getHealth() (reads VITE_API_BASE_URL)
│   │   ├── features/          #     health/HealthStatus.tsx — loading/success/error UI; shows active API base URL
│   │   └── test/              #     setup.ts (jest-dom + RTL cleanup); *.test.tsx mock only the api boundary
│   ├── index.html             #   Vite HTML entry (#root)
│   ├── vite.config.ts         #   @vitejs/plugin-react + @tailwindcss/vite + Vitest (jsdom, v8 cov ≥80%, excl main.tsx/configs)
│   ├── eslint.config.js       #   flat config: typescript-eslint + react-hooks + react-refresh
│   ├── tsconfig*.json          #   project refs: app (DOM) + node; package.json scripts: dev/build/lint/test
│   └── .gitignore             #   node_modules/ · dist/ · coverage/ (also covered by root .gitignore)
├── backend-python/            # FastAPI + Pydantic v2 (uv project, package `app`); SQLAlchemy + Alembic
│   ├── app/                   #   __init__ · config.py (pydantic-settings) · db.py (SQLAlchemy 2.0 engine/
│   │                          #     Session/Base/get_db, psycopg3) · models.py (CANONICAL schema, P2.3) ·
│   │                          #     schema_export.py (normalized snapshot for the parity check) ·
│   │                          #     ingestion/loader.py (P3.1: idempotent normalized-ledger → transactions
│   │                          #       upsert on the DA-19 dedupe_key) · ingestion/income_loader.py (P3.2:
│   │                          #       idempotent pay stubs → paystubs upsert) ·
│   │                          #     precompute/ (P3.2 Python-only analytics: categorize · rates · recurring ·
│   │                          #       pipeline.run_precompute → budget_* aggregates + recurring_charges) ·
│   │                          #     errors.py (P4.1 canonical error envelope; validation→422, DB-down→503) ·
│   │                          #     routers/transactions.py (P4.1 GET /api/v1/transactions: filters + Paginated<T>) ·
│   │                          #     routers/budget.py (P4.2 GET /api/v1/budget: thin read of budget_* aggregates) ·
│   │                          #     routers/goals.py (P4.6 GET /api/v1/goals: thin read of the goals table) ·
│   │                          #     schemas.py (HealthResponse + Transaction/Pagination/PaginatedTransactions/
│   │                          #       TransactionQuery + Budget/BudgetBucket/BudgetCategory/MonthlyNeedsWants/
│   │                          #       RecurringChargeOut) · main.py (create_app, CORS, handlers, /health + tx + budget + goals)
│   ├── alembic/               #   Migrations: env.py reads DATABASE_URL via app.config + imports app.models;
│   │                          #     versions/f0bda61fcf45_* = P2.3 initial schema · ba4cb087cce7_* = P3.2 paystubs
│   ├── alembic.ini            #   Alembic config (URL resolved in env.py; no secrets here)
│   └── tests/                 #   conftest (TestClient) + test_health/test_config/test_db (≥80% cov on app)
├── backend-ts/                # NestJS + TypeORM + class-validator (npm); parity twin of backend-python
│   ├── src/                   #   main.ts (bootstrap: global ValidationPipe, Swagger → /openapi.json,
│   │                          #     listens on TS_API_PORT; global CanonicalExceptionFilter + 422 ValidationPipe) ·
│   │                          #     app.module.ts (ConfigModule reads repo-root .env, TypeOrmModule.forRootAsync
│   │                          #     postgres synchronize:false + resilient dataSourceFactory (DA-18 boot),
│   │                          #     entities: ALL_ENTITIES) · entities/ (entities.ts — TypeORM mirror of the
│   │                          #     Alembic schema, P2.3 · schema-export.ts — normalized snapshot for parity) ·
│   │                          #     errors/ (P4.1 canonical envelope: filter + validation factory → 422/503) ·
│   │                          #     transactions/ (P4.1 controller + query DTO + TypeORM service) ·
│   │                          #     budget/ (P4.2 controller + query DTO + service reading 5 aggregate repos) ·
│   │                          #     goals/ (P4.6 controller + service reading the goals repo, exact integer-cents sum) ·
│   │                          #     health/ (module · controller · service · health-response.dto.ts + *.spec.ts)
│   ├── test/                  #   health.e2e-spec.ts · transactions.e2e-spec.ts · budget.e2e-spec.ts · goals.e2e-spec.ts (Supertest;
│   │                          #     DataSource + repos overridden → boots without a DB; success/422/503 cases)
│   ├── package.json           #   scripts: lint · format:check · test:cov (Jest+SWC, ≥80% global) · start:dev · build
│   ├── tsconfig*.json          #   strict TS; nest-cli.json · eslint.config.mjs · .prettierrc
│   └── .gitignore             #   node_modules/ · dist/ · coverage/ (also covered by root .gitignore)
├── contracts/                 # Cross-backend PARITY HARNESS (Node + Vitest) — enforces Rule #1
│   ├── openapi.canonical.json #   Canonical contract — COMPLETE + FROZEN (P2.2/DA-25): all view +
│   │                          #     source + connections paths + /health; Appendix A baked in
│   │                          #     (Money string, Percentage number, Error envelope, Pagination, enums)
│   ├── redocly.yaml           #   redocly lint config (recommended ruleset, tuned for a local-first app)
│   ├── src/                   #   backends.ts (spawn/poll/teardown both backends; rogue-:8000 guard +
│   │                          #     startDbDownBackends for the DA-18 503 case) · global-setup.ts
│   │                          #     (Vitest globalSetup) · normalize.ts (OpenAPI structural normalizer) ·
│   │                          #     contract.ts (canonical loader + IMPLEMENTED_PATHS allowlist) ·
│   │                          #     schema.ts (schema-parity check, DA-8) · db.ts (synthetic seeds for
│   │                          #     value-parity: transactions P4.1 + budget P4.2 + goals P4.6) · http.ts
│   ├── test/                  #   health-response.parity · openapi.parity (structural diff, scoped to
│   │                          #     implemented paths) · schema.parity (Alembic head ↔ TypeORM entities) ·
│   │                          #     transactions.parity (P4.1: success/422/offset/503) ·
│   │                          #     budget.parity (P4.2: cross-backend identity DA-9 / empty / 503) ·
│   │                          #     goals.parity (P4.6: cross-backend identity DA-9 / empty / 503) ·
│   │                          #     endpoints.parity.stubs (it.todo per endpoint) ·
│   │                          #     normalize.unit · contract.unit · backends.unit · schema.unit
│   ├── package.json           #   scripts: `test:parity` (canonical gate; pretest builds both backends) ·
│   │                          #     `lint:openapi` (redocly) · `mock` (prism mock the canonical doc)
│   ├── vitest.config.ts        #   globalSetup + single-fork · vitest.unit.config.ts (units, no boot)
│   ├── tsconfig.json · README.md · .gitignore
│

├── scripts/                   # Statement ingestion utilities: extract_chase_statements.py (PDF→CSV),
│                              #   ledger.py (per-source normalizers + combined signed-amount ledger)
├── tests/                     # Tests for scripts/ (root uv project; conftest.py wires scripts/ onto path)
│   └── fixtures/              # Small SYNTHETIC CSV fixtures for ingestion tests (never real data)
│
├── config/                    # accounts.example.yaml (committed) + accounts.yaml (gitignored)
├── docs/                      # Committed markdown docs (STRUCTURE.md, setup.md) + GITIGNORED real data (see below)
├── images/                    # GITIGNORED financial screenshots
├── plans/                     # agent_checklist.md, first_pass_high_level_plan.md, checklist_flow.md
├── pull_requests/             # PR description docs (<slug>.md)
│
├── .claude/rules/             # Rule library (*.md; path-scoped via `paths:` frontmatter)
└── .claude/skills/            # Skill library (workflow + diagnostics)
```

## Gitignored real data (never committed)

```
docs/bank_statements/              # Real CSVs + Chase PDF statements
docs/gemini_investments_conversation/   # Personal planning conversation
images/                            # Pay stub, portfolio, retirement screenshots
config/accounts.yaml               # Real seeded balances
```

See `.claude/rules/data-privacy.md`.

## Status

Foundation stage. Built so far: skeleton, both backend project configs, rule + skill libraries, the Chase PDF extractor (`scripts/extract_chase_statements.py`), the **FastAPI backend scaffold** (`backend-python/app/` + Alembic) exposing `GET /health` (P1.2), the **NestJS backend scaffold** (`backend-ts/`) exposing the same `GET /health` → `{"status":"ok"}` plus OpenAPI at `/openapi.json` (P1.3), and the **cross-backend parity harness** (`contracts/`, P1.4) whose `npm run test:parity` boots both backends, asserts response + structural-OpenAPI parity for `/health` against a canonical contract, and tears them down. The **frontend** (`frontend/`, P1.5) is scaffolded (Vite + React + Tailwind v4, TS): a backend-neutral app that renders the configured backend's `/health` via `VITE_API_BASE_URL` and works against either backend. Remaining feature phases are tracked in `plans/agent_checklist.md`.
