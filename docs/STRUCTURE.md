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
> - 2026-05-24: **`GET /api/v1/networth`** (P4.3) — the Net Worth view in **both** backends at parity, a **thin read** of the `accounts` table — **no recompute** in either backend (DA-23). Composition (deterministic, from `accounts.balance` only): `assets` = sum of positive balances, `liabilities` = abs of negative (signed-balance convention), `net_worth` = their net; `accounts[]` sorted by name with `delta_30d` `"0.00"` and `series` **empty** — the snapshot `accounts` table holds no balance history, so neither is fabricated (a clock-derived value would break parity). Python: `app/routers/networth.py` + `NetWorth`/`NetWorthAccount`/`NetWorthSeriesPoint` Pydantic models in `app/schemas.py` (money decimal-string). TS: `src/networth/` (controller + query DTO + service reading the `accounts` repo; totals summed in integer cents — never a float — `toCents`/`centsToDecimalString` helpers). `window` accepted for parity (no history to window over); a null balance counts as 0; empty DB → zero totals + empty arrays. Contracts: `test/networth.parity.test.ts` (cross-backend identity DA-9 / empty-DB zeros / DB-down 503) + `seedNetworthFixture`/`cleanupNetworthFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` now includes the path (structural OpenAPI diff clean). — P4.3.
> - 2026-05-24: **`GET /api/v1/investments`** (P4.4) — the Investments view in **both** backends at parity, a **thin read** of the `holdings` table — **no recompute** in either backend (DA-23). Python: `app/routers/investments.py` + `Investments`/`Allocation`/`Concentration`/`Holding` Pydantic models in `app/schemas.py` (money decimal-string, percentages numeric 0–100; `class` aliased from `class_`). TS: `src/investments/` (controller + service reading the `holdings` repo; sums money in integer **cents** for byte-identical totals, reuses `formatMoney`/`formatPercent`). `portfolio_value`/`unrealized_gain` summed; `allocation[]` grouped by asset class (`actual_pct`=market share, `target_pct`=summed per-holding weights); `concentration[]` per-holding market share ranked desc; `holdings[]` by symbol; empty DB → `"0.00"` totals + empty arrays. Contracts: `test/investments.parity.test.ts` (cross-backend identity DA-9 / empty / DB-down 503) + `seedInvestmentsFixture`/`cleanupInvestmentsFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` now includes the path (structural OpenAPI diff clean). — P4.4.
> - 2026-05-24: **`GET /api/v1/debt`** (P4.5) — the Debt view in **both** backends at parity, a **thin read** of the `loans` table. Python: `app/routers/debt.py` + `Debt`/`DebtTranche`/`PayoffProjection`/`LoanOut`/`LoanPriority`/`PayoffStrategy` models in `app/schemas.py`. TS: `src/debt/` (controller + query DTO + service reading the `loans` repo). Composes `total`, balance-weighted `weighted_avg_rate` (numeric 0–100), `monthly_minimum`, rate `tranches[]` (grouped by rate+priority), `loans[]`, and BOTH `payoff[]` projections — **avalanche** (highest-rate-first acceleration) and **minimums** — from a deterministic **integer-cent amortization** (`project_payoff` / `projectPayoff`) implemented identically in both backends so `debt_free_year`/`total_interest` match to the cent (DA-9). `payoff_strategy`/`loan_priority` use the shared enum registry; optional `strategy` query validates against it (unknown → 422) but does not change the body; empty DB → zeros + empty arrays + two zero projections; DB failure → canonical 503 (DA-18). Contracts: `test/debt.parity.test.ts` (cross-backend identity / avalanche-vs-minimums / strategy-422 / DB-down 503) + `seedDebtFixture`/`cleanupDebtFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` now includes the path (structural OpenAPI diff clean). — P4.5.
> - 2026-05-24: **`GET /api/v1/goals`** (P4.6) — the Goals view in **both** backends at parity, a **thin read** of the `goals` table — **no recompute** in either backend (DA-23). Composition (deterministic, from the `goals` rows): `target`/`saved` = sums (money decimal-string), `progress_pct` = overall ratio `saved/target*100` (numeric 0–100, DA-22), `funding[]` = one `{source,amount}` per goal sorted by name, `affordability{}` = a zero-filled block (the P2.3 schema has no affordability table; neither backend fabricates data). Python: `app/routers/goals.py` + `Goals`/`GoalFunding`/`Affordability` Pydantic models in `app/schemas.py`. TS: `src/goals/` (controller + service reading the `goals` repo; totals summed in integer cents — never a float — `toCents`/`centsToString` helpers). Empty DB → `"0.00"`/`0`/empty funding/zero affordability; DB-down → canonical 503 (DA-18). Contracts: `test/goals.parity.test.ts` (cross-backend identity DA-9 / empty-DB / DB-down 503) + `seedGoalsFixture`/`cleanupGoalsFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` now includes the path (structural OpenAPI diff clean). — P4.6.

> - 2026-05-24: **App shell + core screens** (P5.1, FE). Built the frontend's app shell and six screens against the canonical contract, mock-first. `src/lib/`: extended `api.ts` with typed clients for all six view endpoints + `ApiRequestError` (carries the canonical error envelope); added `types.ts` (wire types per Appendix A), `useApi.ts` (the loading/success/error/**not_connected** state machine — DA-20), `format.ts` (money-string + percent-number display), `theme.tsx`+`themeContext.ts` (light/dark). `src/mocks/`: **MSW** handlers + synthetic fixtures derived from `openapi.canonical.json` (chosen over Prism — in-process, no extra service, same handlers power the dev worker and the Vitest suite) with `?scenario=empty|error` control; `browser.ts` (dev worker, started from `main.tsx` only when `VITE_API_BASE_URL` is unset — **DA-21**) + `server.ts` (Vitest). `src/components/`: app shell (`AppLayout` + `Sidebar` with react-router-dom v7 `NavLink`, Story/Budget/NetWorth/Investments/Debt/Goals + a disabled Data-sources placeholder for P5.2) and shared UI (`ScreenState`, `StatCard`, `MeterRow`, `BarChart`, `DataTable`, `Card`, `Badge`, `InsightCallout`, `PageHeader`). `src/features/`: `story/` (cross-domain narrative home) + `budget`/`networth`/`investments`/`debt`/`goals`, each rendering from its endpoint with explicit loading / data / not_connected / error states; mirrors `pencil/website_wire.pen`. Removed the P1.5 `features/health/` placeholder. FE gate green (lint + Vitest ≥80% + build); Playwright screenshots vs. the mock + a live-backend wiring smoke run. — P5.1.

> - 2026-05-24: **Settings / Data Sources + Plaid Link module** (P5.2, FE). Activated the Sidebar's disabled Data-sources placeholder into a `/settings` `NavLink`; added the `src/features/connections/` module: `SettingsScreen` reads `GET /api/v1/connections` and renders one `SourceCard` per source with its Local↔API `ModeToggle`, status `Badge`, and the right CTA, plus a linked-Items summary. The isolated Plaid flow lives in `usePlaidConnect` (the only `react-plaid-link` coupling): link-token → open Link → `onSuccess(public_token)` → exchange; `ConnectButton` renders **Connect** (`not_connected`/`disconnected`) or **Reconnect** (`needs_reauth`/`error` — Plaid update mode, DA-13); `connected` has no CTA. All four `item_status` states render. `react-plaid-link` is **`vi.mock`-ed in tests** (no real Link/credentials — privacy). `api.ts` gained `postJson` + `getConnections`/`createLinkToken`/`exchangePublicToken`/`setSourceMode`; `types.ts` gained the connections wire types; `mocks/` gained connections fixtures (all states) + handlers (the backend connections endpoints are **P6.1**; mocked per DA-21). The Local↔API toggle POSTs to a **mock-only** `/connections/source-mode` placeholder (NOT canonical — the adapter swap is **P6.4 `BE`**). FE gate green (lint + Vitest 68 tests / 95% stmts ≥80% + build); Playwright screenshot of the Settings screen vs. the mock. — P5.2.

> - 2026-05-24: **Connections API + encrypted Item store + webhook** (P6.1, BE) — the Plaid connection lifecycle in **both** backends at strict parity. Python `app/connections/` + TS `src/connections/` (parity twins): `POST /api/v1/connections/link-token` (Plaid Link token), `POST /api/v1/connections/exchange` (exchange `public_token` → **encrypt + store** the `access_token`, never returned), `GET /api/v1/connections` (per-source `{mode,status}` + linked Items), `POST /api/v1/connections/webhook` (ES256 JWT/JWKS-verified — `iat` freshness + raw-body SHA-256 + rate-limit; unverified/forged/unsigned → canonical **401**, DA-11), and an OAuth redirect with a strict allowlist (no open redirect). **Token-at-rest (DA-12):** AES-256-GCM, key = base64 `APP_ENCRYPTION_KEY`, on-disk `nonce(12)‖ciphertext‖tag(16)` **byte-compatible across backends** (Python `cryptography.AESGCM` ↔ TS `node:crypto`). The Plaid client is **injected** (`PLAID_FAKE=1` selects a network-free fake → CI is hermetic); logs are **token-scrubbed** (DA-14). Reused the canonical 401 in both error layers (`app/errors.py` `UnauthorizedError`; `CanonicalUnauthorizedException`). Contracts: `IMPLEMENTED_PATHS` now includes the four connections paths (structural OpenAPI diff clean) + `test/connections.parity.test.ts` proving identical shapes, **no plaintext at rest**, **cross-backend decrypt**, forged/unsigned-webhook 401, **log-scrub**, and the redirect allowlist; the parity harness boots both backends with `PLAID_FAKE=1` + a synthetic shared key and captures logs to `contracts/.parity-logs/` (gitignored). Happy path verified end-to-end against the **real Plaid Sandbox** locally. — P6.1.

> - 2026-05-24: **Docker dual-frontend stack** (P7.1, INFRA). `docker compose up --build` now runs the WHOLE stack: `postgres`, a one-shot `migrate` (backend-python image → `alembic upgrade head`, gated on `postgres` healthy), **both** backends (`backend-python` :8000, `backend-ts` :3000 — gated on `migrate` completed + `postgres` healthy, each with a `/health` healthcheck), and the SAME frontend image built twice — `frontend-python` (**:8501** → FastAPI) and `frontend-ts` (**:8502** → NestJS). Added `backend-python/Dockerfile` (multi-stage uv: `uv sync --locked` deps layer → slim runtime with the venv + `app/`/`alembic/`/`alembic.ini`, uvicorn on 0.0.0.0:8000), `backend-ts/Dockerfile` (multi-stage node: `npm ci` + `nest build` → prod-only runtime running `node dist/main.js` on :3000), `frontend/Dockerfile` + `frontend/nginx.conf.template` (build SPA with `VITE_API_BASE_URL=/api` → `nginx:alpine` serving the SPA with `try_files … /index.html` AND reverse-proxying `/api/` to `${BACKEND_UPSTREAM}` via built-in envsubst, `NGINX_ENVSUBST_FILTER=^BACKEND_`; trailing-slash `proxy_pass` strips the `/api` prefix → same-origin, no CORS), and `.dockerignore` in each (exclude venv/node_modules/tests/`.env`). Backends are NOT published to the host (host :8000 often occupied); Postgres host-publish moved to **5433** (host :5432 often occupied), internal `postgres:5432` unchanged; `pf_pgdata` retained. Frontend fix (FE, no contract change): `src/lib/api.ts` `buildUrl` resolves a **relative** base (`/api`) against `window.location.origin` so `new URL()` works under the proxy (+ test). FE gate green; app gates unaffected (Docker/compose/nginx only). — P7.1.

Canonical source of truth for the repo layout. **Update this on every merge that adds/removes top-level dirs or key files** (same discipline as README — see `.claude/rules/structure-on-merge.md`).

## Top-level

```
personal_finance/
├── CLAUDE.md                  # Agent guidance (full briefing)
├── docker-compose.yml         # Full stack (P7.1): postgres + migrate one-shot + both backends + 2 frontends (8501→py, 8502→ts)
├── .env.example               # Env template (copy to .env; gitignored)
├── pyproject.toml             # ROOT uv project: data-prep utilities (scripts/ + tests/)
│
├── frontend/                  # React 19 + Vite 8 + Tailwind v4 (TS, strict) — backend-neutral via VITE_API_BASE_URL
│   ├── public/                #   mockServiceWorker.js (vendored by `msw init`; the dev mock worker)
│   ├── src/                   #   main.tsx (entry; starts MSW when no backend) · App.tsx (router + shell) · index.css (theme tokens)
│   │   ├── lib/               #     api.ts (single network boundary: view-endpoint clients + ApiRequestError) ·
│   │   │                      #       types.ts (contract wire types) · useApi.ts (loading/success/error/not_connected) ·
│   │   │                      #       format.ts (money/percent) · theme.tsx + themeContext.ts (light/dark)
│   │   ├── mocks/             #     handlers.ts + fixtures.ts (synthetic, from the canonical contract) · browser.ts · server.ts
│   │   ├── components/        #     app shell + shared UI (AppLayout, Sidebar, ScreenState, StatCard, MeterRow,
│   │   │                      #       BarChart, DataTable, Card, Badge, InsightCallout, PageHeader)
│   │   ├── features/          #     one module per screen: story/ budget/ networth/ investments/ debt/ goals/ connections/
│   │   │                      #       connections/ = Settings screen + isolated Plaid Link flow (usePlaidConnect, react-plaid-link)
│   │   └── test/              #     setup.ts (jest-dom + MSW Node server + localStorage/matchMedia polyfills) · renderWithProviders.tsx
│   ├── Dockerfile             #   P7.1: build SPA (VITE_API_BASE_URL=/api) → nginx:alpine SPA host + /api proxy (one image, 2 instances)
│   ├── nginx.conf.template    #   P7.1: envsubst ${BACKEND_UPSTREAM} → serve SPA (try_files) + reverse-proxy /api/ (prefix-stripped)
│   ├── .dockerignore          #   exclude node_modules/ · dist/ · coverage/ · .env
│   ├── index.html             #   Vite HTML entry (#root)
│   ├── vite.config.ts         #   @vitejs/plugin-react + @tailwindcss/vite + Vitest (jsdom, v8 cov ≥80%, excl main.tsx/mocks/browser/configs)
│   ├── eslint.config.js       #   flat config: typescript-eslint + react-hooks + react-refresh
│   ├── tsconfig*.json          #   project refs: app (DOM) + node; package.json scripts: dev/build/lint/test
│   └── .gitignore             #   node_modules/ · dist/ · coverage/ · *.local (also covered by root .gitignore)
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
│   │                          #     routers/networth.py (P4.3 GET /api/v1/networth: thin read of accounts table) ·
│   │                          #     routers/investments.py (P4.4 GET /api/v1/investments: thin read of holdings) ·
│   │                          #     routers/debt.py (P4.5 GET /api/v1/debt: thin read of loans + payoff projections) ·
│   │                          #     routers/goals.py (P4.6 GET /api/v1/goals: thin read of the goals table) ·
│   │                          #     connections/ (P6.1 Plaid connections API: router.py link-token/exchange/list/
│   │                          #       webhook + OAuth-redirect allowlist · crypto.py AES-256-GCM token-at-rest,
│   │                          #       DA-12 · webhook.py ES256 JWT/JWKS verify, DA-11 · plaid_gateway.py +
│   │                          #       fake_gateway.py injected client (PLAID_FAKE) · redaction.py log scrub, DA-14) ·
│   │                          #     schemas.py (HealthResponse + Transaction/Pagination/PaginatedTransactions/
│   │                          #       TransactionQuery + Budget/BudgetBucket/BudgetCategory/MonthlyNeedsWants/
│   │                          #       RecurringChargeOut + NetWorth/NetWorthAccount/NetWorthSeriesPoint +
│   │                          #       Investments/Allocation/Concentration/Holding +
│   │                          #       Debt/DebtTranche/PayoffProjection/LoanOut +
│   │                          #       Goals/GoalFunding/Affordability) ·
│   │                          #       main.py (create_app, CORS, handlers, /health + tx + budget + networth + investments + debt + goals)
│   ├── alembic/               #   Migrations: env.py reads DATABASE_URL via app.config + imports app.models;
│   │                          #     versions/f0bda61fcf45_* = P2.3 initial schema · ba4cb087cce7_* = P3.2 paystubs
│   ├── alembic.ini            #   Alembic config (URL resolved in env.py; no secrets here)
│   ├── Dockerfile             #   P7.1: multi-stage uv (uv sync --locked) → slim runtime (venv + app/ + alembic/); uvicorn 0.0.0.0:8000
│   ├── .dockerignore          #   exclude .venv/ · tests/ · __pycache__/ · .env
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
│   │                          #     networth/ (P4.3 controller + query DTO + service reading accounts repo) ·
│   │                          #     investments/ (P4.4 controller + service reading the holdings repo, cents sum) ·
│   │                          #     debt/ (P4.5 controller + query DTO + service reading loans repo + payoff sim) ·
│   │                          #     goals/ (P4.6 controller + service reading the goals repo, exact integer-cents sum) ·
│   │                          #     connections/ (P6.1 Plaid connections: controller (link-token/exchange/list/webhook +
│   │                          #       OAuth-redirect allowlist) + service + DTOs · crypto.ts AES-256-GCM token-at-rest,
│   │                          #       DA-12 · webhook.ts ES256 JWT/JWKS verify, DA-11 · plaid.gateway.ts + fake-gateway.ts
│   │                          #       injected client (PLAID_FAKE) · redaction.ts log scrub, DA-14) ·
│   │                          #     health/ (module · controller · service · health-response.dto.ts + *.spec.ts)
│   ├── test/                  #   health.e2e-spec.ts · transactions.e2e-spec.ts · budget.e2e-spec.ts ·
│   │                          #     networth.e2e-spec.ts · investments.e2e-spec.ts · debt.e2e-spec.ts · goals.e2e-spec.ts ·
│   │                          #     connections.e2e-spec.ts (Supertest;
│   │                          #     DataSource + repos overridden → boots without a DB; success/422/401/503 cases)
│   ├── package.json           #   scripts: lint · format:check · test:cov (Jest+SWC, ≥80% global) · start:dev · build
│   ├── tsconfig*.json          #   strict TS; nest-cli.json · eslint.config.mjs · .prettierrc
│   ├── Dockerfile             #   P7.1: multi-stage node (npm ci + nest build) → prod-only runtime; node dist/main.js on :3000
│   ├── .dockerignore          #   exclude node_modules/ · dist/ · test/ · .env
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
│   │                          #     value-parity: transactions P4.1 + budget P4.2 + networth P4.3 + investments P4.4 + debt P4.5 + goals P4.6) · http.ts
│   ├── test/                  #   health-response.parity · openapi.parity (structural diff, scoped to
│   │                          #     implemented paths) · schema.parity (Alembic head ↔ TypeORM entities) ·
│   │                          #     transactions.parity (P4.1: success/422/offset/503) ·
│   │                          #     budget.parity (P4.2: cross-backend identity DA-9 / empty / 503) ·
│   │                          #     networth.parity (P4.3: cross-backend identity DA-9 / empty-DB zeros / 503) ·
│   │                          #     investments.parity (P4.4: cross-backend identity DA-9 / empty / 503) ·
│   │                          #     debt.parity (P4.5: identity / avalanche-vs-minimums / 422 / 503) ·
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

Foundation stage. Built so far: skeleton, both backend project configs, rule + skill libraries, the Chase PDF extractor (`scripts/extract_chase_statements.py`), the **FastAPI backend scaffold** (`backend-python/app/` + Alembic) exposing `GET /health` (P1.2), the **NestJS backend scaffold** (`backend-ts/`) exposing the same `GET /health` → `{"status":"ok"}` plus OpenAPI at `/openapi.json` (P1.3), and the **cross-backend parity harness** (`contracts/`, P1.4) whose `npm run test:parity` boots both backends, asserts response + structural-OpenAPI parity for `/health` against a canonical contract, and tears them down. The **frontend** (`frontend/`, P1.5 scaffold → P5.1) is a backend-neutral React + Vite + Tailwind v4 app: an app shell (sidebar nav + client routing + light/dark theme) and the six core screens (Story, Budget, Net Worth, Investments, Debt, Goals), each rendering from its view endpoint with explicit loading / data / not-connected / error states. It develops mock-first against an **MSW** mock derived from the canonical contract (`VITE_API_BASE_URL` unset) and points the same client at a live backend when the URL is set (DA-21). Remaining feature phases (Settings/Plaid Link, live connectors, hardening) are tracked in `plans/agent_checklist.md`.
