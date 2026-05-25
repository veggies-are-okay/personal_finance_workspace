# Agent Checklist — Personal Finance App

> CHANGELOG
> - 2026-05-24: Initial checklist. Phases P0–P9 for the dual-backend parity build. — Foundation pass.
> - 2026-05-24: Restructured P2+ for the **data-connectors & frontend** program (see `docs/2026-05-24-data-connectors-and-frontend-design.md`). Contract-first + 3-wave vertical slicing; backend-owned Plaid/RentCast adapters behind a stable source/view contract; precompute-at-ingestion (revises old P4.2); CI rewrite; docker dual-frontend. Analysis (LangGraph/Gemini) client deferred. — Connectors pass.
> - 2026-05-24: **Devils-advocate hardening** (`docs/qa.md`): added Appendix A (canonical contract conventions) + Appendix B (exact gate commands); tightened every Verify to be observable; added error-shape/money/date/enum/null/pagination parity, failure modes (DB-down 503, not-connected 200-empty), Plaid security (webhook JWT, token encryption, no-token-logging, over-mock guards), idempotency key, and CI working-dir/Postgres fixes. — Hardening pass.

**Single source of truth for tasks.** Work top-to-bottom by subsection (one `###` block = one branch). Mark `- [x]` only when the **Verify** step passes. For blocked/skipped tasks add `> BLOCKED:` / `> SKIPPED:`. Every API/behavior change lands in **both** backends + `contracts/` in the same branch (`.claude/rules/backend-parity.md`). Execute each subsection **TDD** (red→green→refactor). Branch types per `.claude/rules/branching.md`.

**References:** contract/architecture → `docs/2026-05-24-data-connectors-and-frontend-design.md`; hardening decisions → `docs/qa.md`; **contract conventions → Appendix A**; **exact gate commands → Appendix B**; screens → `pencil/website_wire.pen`.

**Parity rule for every API task:** the change exists in FastAPI **and** NestJS; `contracts/` has an added/updated parity test; the OpenAPI structural diff vs `openapi.canonical.json` is clean; money/date/enum/null follow Appendix A. Stage-4 branches **must not edit** `openapi.canonical.json` (frozen in P2.2 — DA-25).

**Integration:** every subsection ships via the `branch-finalization` skill as a **CI-gated PR** into the protected `main` (push → PR → merge only on green) — never a local merge (`.claude/rules/pull-requests.md`).

---

## P0 — Foundations
### P0.1 — Repo scaffold, rules & skills — [x]
### P0.2 — Statement ingestion (Chase PDFs) — [x]
### P0.3 — Ingestion: remaining sources — [x]

## P1 — Infra & scaffolds
### P1.1 — Postgres — [x]
### P1.2 — backend-python scaffold (FastAPI) — [x]
### P1.3 — backend-ts scaffold (NestJS) — [x]
### P1.4 — Parity harness — [x]
### P1.5 — frontend scaffold — [x]

---

## Wave 0 — Program foundation

## P2 — Engineering foundation

### P2.1 — CI rewrite + repo hygiene  *(type: DEPLOY)*
- [x] Replace `.github/workflows/ci.yml` with four jobs, each in its **own working directory** (two uv projects exist — the Python *backend* is `backend-python/`, not repo root): `python-backend` (`backend-python/`), `ts-backend` (`backend-ts/`), `frontend` (`frontend/`), `parity` (`contracts/`). Add a **Postgres service container**; run `alembic upgrade head` before backend/integration tests. Drop alpha `ty`. Remove stray `backend-ts/src 2/` and `docs/Untitled`; commit `.github/`. Add `.env.example` keys (`PLAID_CLIENT_ID/SECRET/ENV`, `RENTCAST_API_KEY`, `APP_ENCRYPTION_KEY`, `DATABASE_URL`); confirm `.env` is gitignored. (DA-15/16/17/26)
  - *Verify:* on a no-op PR all four jobs run **green** using the Appendix B commands; `git check-ignore .env` passes; `backend-ts/src 2/` and `docs/Untitled` gone; **branch protection** (GitHub repo setting — documented in the PR doc) requires all four checks before merge to `main`.

### P2.2 — Canonical API contract & mock  *(type: BE — contracts only; authored FIRST, then frozen)*
- [x] Author the **complete** canonical OpenAPI in `contracts/openapi.canonical.json` for **all** paths up front (so Stage-4 branches never edit it — DA-25): view (`/api/v1/{transactions,budget,networth,investments,debt,goals}`), source (`/api/v1/sources/*`), connections (`/api/v1/connections/*`). Bake in **Appendix A conventions**: the canonical `Error` schema, money as decimal-string, ISO-8601 UTC datetimes, the `Paginated<T>` envelope, the enum registry, null-omission, numeric percentages. Lint the spec (`redocly lint` or `spectral`). Add a **Prism mock** script that serves the canonical doc. Add per-endpoint parity-test stubs + extend the structural OpenAPI-diff in the parity harness.
  - *Verify:* spec lints clean; `prism mock contracts/openapi.canonical.json` serves every path with example bodies that satisfy Appendix A; parity harness loads the canonical doc and the structural-diff scaffold runs; no backend implementation yet.

### P2.3 — DB schema & Item store  *(type: DB)*
- [x] One Alembic migration (canonical) **and** mirrored TypeORM entities (`synchronize:false`) for: `accounts`, `transactions` (+ `category`, `bucket`, `is_transfer`, `is_recurring`), `categories`, `budgets`, `loans`, `goals`, `holdings`, `budget_aggregates` + `recurring_charges` (columns covering **every** `/budget` field — DA-23), `plaid_items` (`user_id`, `item_id`, `access_token` **`BYTEA`** ciphertext, `institution`, `products[]`, `status`), `source_config` (`source`, `mode`). Column types per Appendix A: money `NUMERIC(14,2)`, datetimes `timestamptz`, enums text+CHECK (or PG enum), token `BYTEA`. (DA-8/12/22/23)
  - *Verify:* `alembic upgrade head` applies on a clean DB; TypeORM connects to the same schema with `synchronize:false`; the **schema-parity check** (Alembic head ↔ entities) passes incl. column types for money/datetime/enum/token; no plaintext token column exists.

## Wave 0.5 — Ingestion → DB + precompute

## P3 — Ingestion & precompute
### P3.1 — Load normalized ledger into Postgres (idempotent)  *(type: BE-PY)*
- [x] Loader writes the normalized ledger to `transactions`; re-import **upserts** on the dedupe key `hash(account, date, signed_amount, normalized_description)` (DA-19).
  - *Verify:* on synthetic fixtures, loading **twice** yields no duplicates and identical row counts; the dedupe key is unique-constrained; root gate `uv run pytest` green.
### P3.2 — Precompute deterministic analytics  *(type: BE-PY)*
- [x] Port the EDA logic (categorization, transfer + recurring detection, 50/30/20 buckets, savings rate, monthly aggregates) from the notebooks into `scripts/` (productionized) → `budget_aggregates` + `recurring_charges` + enrichment cols. Percentages numeric 0–100 (Appendix A). **No categorization logic in TS.** (DA-9/22) — Added the `paystubs` income table (model + Alembic `ba4cb087cce7` + mirrored `PaystubEntity` + schema-parity updated), an idempotent income loader (`app/ingestion/income_loader.py`), and the Python-only `app/precompute/` package writing every `/budget` aggregate table. Golden-fixture tests assert exact values + determinism; both backends only READ these tables.
  - *Verify:* **golden-fixture** tests (synthetic input → asserted aggregate values) pass and are deterministic across runs; both backends later read these tables without recomputing (asserted by the P4.2 cross-backend identity test).

## Wave 1 — View endpoints (CSV/precomputed) + frontend

> Each P4 subsection is a `BE` vertical: implement the endpoint in **both** backends reading precomputed/normalized tables (no recompute), add a `contracts/` parity test, keep the OpenAPI diff clean. **Do not edit** `openapi.canonical.json`.

### P4.1 — `GET /api/v1/transactions` (list/search/filter/paginate)  *(type: BE)* — [x]
- [x] Both backends; `Paginated<T>` envelope (Appendix A); filters by date/account/category.
  - *Verify:* Appendix B gates (PY+TS+FE-n/a) + `npm run test:parity` green; parity tests cover success, **invalid query → canonical 422** (DA-1), **offset past end → empty `data` + correct `total`** (DA-4), and **DB-unavailable → identical 503 canonical body** (DA-18); money is decimal-string, dates `Z`.
  - *Done (2026-05-24):* FastAPI `app/routers/transactions.py` + `app/errors.py` (RequestValidationError→422, ServiceUnavailableError→503); NestJS `src/transactions/` + `src/errors/` (global filter + 422 ValidationPipe factory) + resilient `dataSourceFactory` so a DB-down boot still 503s (DA-18). Money decimal-string, dates `YYYY-MM-DD`, optionals omitted (DA-6). Established the reusable error/pagination patterns P4.2–P4.6 inherit. `contracts/test/transactions.parity.test.ts` covers DA-1/DA-4/DA-18 + success; `IMPLEMENTED_PATHS` adds the path (OpenAPI structural diff clean). Gates: Python 126 tests / 99% cov; TS 81 tests / 99.5% cov; parity 51 passed.
### P4.2 — `GET /api/v1/budget`  *(type: BE)* — [x]
- [x] Both backends read `budget_aggregates`/`recurring_charges` only.
  - *Verify:* Appendix B gates + parity; a **cross-backend identity** parity test asserts `/budget` is byte-identical from FastAPI and NestJS for a seeded DB (DA-9); percentages numeric, money decimal-string.
  - *Done (2026-05-24):* FastAPI `app/routers/budget.py` + `Budget`/`BudgetBucket`/`BudgetCategory`/`MonthlyNeedsWants`/`RecurringChargeOut` Pydantic models in `app/schemas.py`; NestJS `src/budget/` (controller + `BudgetQueryDto` + service reading 5 aggregate repos, `formatPercent` helper). Thin reads of the precomputed `budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges` — **no recompute in either backend** (DA-23). `window` selector (default `12m`); deterministic ordering (50/30/20 buckets, categories/monthly/recurring sorted); empty DB → zeros + empty arrays. Money decimal-string, percentages numeric 0–100 (DA-22), dates `YYYY-MM-DD`; DB-down → canonical 503 (DA-18). `contracts/test/budget.parity.test.ts` covers cross-backend identity (DA-9) + unknown-window-empty + DB-down 503; `seedBudgetFixture`/`cleanupBudgetFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` adds the path (OpenAPI structural diff clean). Gates: Python 135 tests / 99% cov; TS 100 tests / 90.6% cov; parity 54 passed.
### P4.3 — `GET /api/v1/networth`  *(type: BE)* — [x] Both backends + parity.
  - *Verify:* Appendix B gates + parity; empty-DB → zeros/empty arrays, identical both backends.
### P4.4 — `GET /api/v1/investments`  *(type: BE)* — [x]
  - *Verify:* Appendix B gates + parity; concentration/allocation numeric percentages (Appendix A).
  - *Done (2026-05-24):* FastAPI `app/routers/investments.py` + `Investments`/`Allocation`/`Concentration`/`Holding` Pydantic models in `app/schemas.py`; NestJS `src/investments/` (controller + service reading the `holdings` repo). A **thin read** of the `holdings` table — **no recompute in either backend** (DA-23). `portfolio_value`/`unrealized_gain` summed (TS sums in integer **cents** for byte-identical totals); `allocation[]` grouped by `asset_class` (`actual_pct` = market share, `target_pct` = summed per-holding `weight`, `amount`); `concentration[]` per-holding market share ranked desc then symbol; `holdings[]` ordered by symbol (stored per-holding `weight`). Allocation/concentration/holding percentages numeric 0–100 (DA-22); market values decimal-string (DA-2); NULL `asset_class` → `unclassified`; empty DB → `"0.00"` totals + empty arrays; DB-down → canonical 503 (DA-18). `contracts/test/investments.parity.test.ts` covers cross-backend identity (DA-9) + empty-DB + DB-down 503; `seedInvestmentsFixture`/`cleanupInvestmentsFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` adds the path (OpenAPI structural diff clean). Gates: Python 145 tests / 99% cov (1 pre-existing env-string config test deselected — passes when `DATABASE_URL` matches the CI default); TS 123 tests / 87.6% cov; parity 57 passed.
### P4.5 — `GET /api/v1/debt`  *(type: BE)* — [x] Both backends + parity.
  - *Verify:* Appendix B gates + parity; `payoff_strategy`/`loan_priority` enums per registry; avalanche vs minimums both covered.
  - *Done (2026-05-24):* FastAPI `app/routers/debt.py` + `Debt`/`DebtTranche`/`PayoffProjection`/`LoanOut`/`LoanPriority`/`PayoffStrategy` in `app/schemas.py`; NestJS `src/debt/` (controller + `DebtQueryDto` `@IsIn` + service reading the `loans` repo). Thin read of `loans` → `total`, balance-weighted `weighted_avg_rate` (numeric 0–100), `monthly_minimum`, rate `tranches[]` (grouped by rate+priority), `loans[]`, and BOTH `payoff[]` projections — **avalanche** (highest-rate-first acceleration) and **minimums** — from a deterministic **integer-cent amortization** (`project_payoff`/`projectPayoff`) implemented identically in both backends so `debt_free_year`/`total_interest` match to the cent (DA-9). `payoff_strategy`/`loan_priority` use the `app.models` enum registry; optional `strategy` query validates against it (unknown → 422) without changing the body; empty DB → zeros + empty arrays + two zero projections; DB-down → canonical 503 (DA-18). `contracts/test/debt.parity.test.ts` covers cross-backend identity + avalanche-vs-minimums + strategy-422 + DB-down 503; `seedDebtFixture`/`cleanupDebtFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` adds the path (OpenAPI structural diff clean). Gates: Python 150 tests / 99% cov; TS 134 tests / 93.6% cov; parity 58 passed.
### P4.6 — `GET /api/v1/goals`  *(type: BE)* — [x]
- [x] Both backends read the `goals` table only (thin read).
  - *Verify:* Appendix B gates + parity; money decimal-string.
  - *Done (2026-05-24):* FastAPI `app/routers/goals.py` + `Goals`/`GoalFunding`/`Affordability` Pydantic models in `app/schemas.py`; NestJS `src/goals/` (controller + service reading the `goals` repo, `toCents`/`centsToString` exact-sum helpers). Thin read of the `goals` table composed into the frozen canonical shape — **no recompute** (DA-23): `target`/`saved` summed (money decimal-string), `progress_pct` the overall ratio (numeric 0–100, DA-22), `funding[]` one `{source,amount}` per goal sorted by name, `affordability{}` a zero-filled block (no backing table in the P2.3 schema). Empty DB → `"0.00"`/`0`/empty funding/zero affordability. DB-down → canonical 503 (DA-18). `contracts/test/goals.parity.test.ts` covers cross-backend identity (DA-9) + empty-DB + DB-down 503; `seedGoalsFixture`/`cleanupGoalsFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` adds the path (OpenAPI structural diff clean). Gates: Python 7 goals tests (suite 99% cov); TS 122 tests / 88.5% cov; parity 57 passed.

## P5 — Frontend (built against the mock, then wired)
### P5.1 — App shell + core screens  *(type: FE — `FE/core-screens`)*
- [x] Sidebar nav + routing + theme; Story/Budget/Net Worth/Investments/Debt/Goals rendering from the view endpoints — **mock generated from `openapi.canonical.json`** first, then `VITE_API_BASE_URL` (DA-21). Loading / empty / error states per screen (incl. `not_connected` empty state — DA-20). Mirrors `pencil/website_wire.pen`.
  - *Verify:* frontend gate (Appendix B) incl. ≥80% coverage + `build`; Playwright check against the mock; a **wiring smoke run** against one live backend after P4 merges (DA-21).
### P5.2 — Settings/Data Sources + Plaid Link module  *(type: FE — `FE/settings-connections`)*
- [x] Settings reads `GET /api/v1/connections` (per-source `mode`/`item_status`); isolated `features/connections/` module embeds `react-plaid-link` (link-token → public_token → exchange). Renders `connected`/`needs_reauth`/`error`/`not_connected` states with a **Reconnect** CTA (update mode — DA-13). Local↔API toggle calls the connections API.
  - *Verify:* frontend gate; mock-driven Link flow renders all four `item_status` states; toggling mode calls the API.
  - *Done (2026-05-24):* Activated the Sidebar Data-sources placeholder → `/settings` `NavLink`. `src/features/connections/`: `SettingsScreen` (reads `GET /api/v1/connections` via `useApi`+`ScreenState`) renders one `SourceCard` per source — `ModeToggle` (Local↔API radiogroup), status `Badge`, and CTA — plus a linked-Items summary. `usePlaidConnect` is the **only** `react-plaid-link` coupling (link-token → open Link → `onSuccess` → exchange); `ConnectButton` shows **Connect** (`not_connected`/`disconnected`) or **Reconnect** (`needs_reauth`/`error`, Plaid update mode — DA-13); `connected` has no CTA — **all four `item_status` states render**. `react-plaid-link` is **`vi.mock`-ed** in every test (no real Link/credentials — privacy). `api.ts` += `postJson` + `getConnections`/`createLinkToken`/`exchangePublicToken`/`setSourceMode`; `types.ts` += connections wire types; `mocks/` += connections fixtures (all states) + handlers (backend connections = **P6.1**; mocked per DA-21). The Local↔API toggle POSTs to a **mock-only** `/connections/source-mode` placeholder (NOT canonical; adapter swap is **P6.4 `BE`**) — tests assert the **request fires** + `onModeChanged`. Gate: `lint` clean · Vitest **68 tests pass, coverage 95.3% stmts / 83.5% branch / 96.4% funcs / 96.7% lines** (≥80) · `build` green. Playwright screenshot of `/settings` vs. the mock in `pull_requests/evidence/p5-2-settings-connections/proof.png`.

## Wave 2 — Live connectors (adapter swap behind the same endpoints)

### P6.1 — Connections API + encrypted Item store + webhook  *(type: BE)*
- [x] `/connections/{link-token,exchange,webhook}` + `GET /connections` in both backends; OAuth redirect route. **Encrypt `access_token` (AES-256-GCM, key from `APP_ENCRYPTION_KEY` env) on write, decrypt on read** — identical scheme both backends (DA-12). **Verify Plaid webhooks via JWT/JWKS**, validate body schema, rate-limit, reject unverified → 401 (DA-11). **Redaction:** never log tokens/PII (DA-14). Plaid **mocked** in CI (respx/nock) — no live calls/secrets.
  - *Verify:* Appendix B gates + parity; round-trip test shows **no plaintext token at rest**; an unsigned/forged webhook → 401; a log-scrub test finds no token string in logs; CI hermetic.
  - *Done (2026-05-24):* Both backends serve `POST /api/v1/connections/{link-token,exchange,webhook}` + `GET /api/v1/connections` + `GET /api/v1/connections/oauth` (allowlisted redirect, excluded from OpenAPI). Python `app/connections/` + TS `src/connections/` are parity twins. **Token-at-rest (DA-12):** `crypto.py`/`crypto.ts` AES-256-GCM, `nonce(12)‖ct‖tag(16)`, **byte-compatible** (`cryptography.AESGCM` ↔ `node:crypto`) — proven by a `contracts/` cross-backend decrypt test. **Webhook (DA-11):** ES256 JWT verified against the Plaid JWKS (cached), `iat` freshness (5 min), raw-body SHA-256 match, rate-limited; unverified/forged/unsigned → canonical **401** (added `UnauthorizedError`/`CanonicalUnauthorizedException`). Plaid client **injected** (`PLAID_FAKE=1` → network-free fake, hermetic CI). **Redaction (DA-14):** `redaction.py`/`redaction.ts` scrub `access/public/link` tokens from all logs. Contracts: 4 paths added to `IMPLEMENTED_PATHS` (structural OpenAPI diff clean) + `test/connections.parity.test.ts` (identical shapes · no plaintext at rest · cross-backend decrypt · forged/unsigned-webhook 401 · log-scrub · redirect allowlist). Gates: **python** ruff+format clean, pytest **218 pass / 96.7% cov** (≥80); **ts** lint+format clean, jest **250 pass / 89.6% cov** (≥80); **parity** `npm run test:parity` **79 pass** (all connections invariants) + clean OpenAPI diff. Happy path verified end-to-end against the **real Plaid Sandbox** locally (`pull_requests/evidence/p6-1-connections-api/proof.png`; tokens redacted).
### P6.2 — Plaid adapter (transactions · liabilities · investments · income)  *(type: BE)*
- [ ] Adapter maps Plaid products → source schemas; `source_config.mode=api` routes `/sources/*` through Plaid. Tests inject a fake client returning **recorded Sandbox fixtures** and assert the **mapping + DB side effects** (not "SDK called" — DA-10). Handle `ITEM_LOGIN_REQUIRED`/pending/invalid → `item_status` + block fetches (DA-13). Run `/institutions/search?products=investments` for **E*TRADE coverage**; if absent, open an E*TRADE-direct follow-up and keep holdings on CSV (DA-24).
  - *Verify:* Appendix B gates + parity; mapping assertions on recorded fixtures pass; an `ITEM_LOGIN_REQUIRED` fixture sets `needs_reauth`; coverage result recorded in `docs/qa.md`; **owner runs the local Trial real-data runbook** (results not committed).
### P6.3 — RentCast adapter for `/sources/listings`  *(type: BE)*
- [ ] API-key GET → listings/comps schema, both backends; key from `RENTCAST_API_KEY` env only; mocked in CI.
  - *Verify:* Appendix B gates + parity; mapping asserted on a recorded fixture; no key in repo.
### P6.4 — Settings wiring + fallbacks doc  *(type: FE + DOCS)*
- [ ] Local↔API toggle swaps the adapter end-to-end; **not-connected** source returns `200` + empty `data` + `source_status:"not_connected"`, identical both backends (DA-20). Document SimpleFIN/direct-bank fallbacks + the Plaid Production cost note.
  - *Verify:* toggling a source flips its data origin with no contract change; not-connected parity case passes; frontend gate.

## Wave 3 — Hardening & delivery

### P7.1 — Docker dual-frontend  *(type: INFRA)*
- [x] Compose builds the frontend twice: `8501 → python (:8000)`, `8502 → ts (:3000)`, plus Postgres + both backends.
  - *Verify:* both URLs load the app wired to their respective backend; the active base URL differs by instance.
### P7.2 — Parity & contract hardening  *(type: BE)*
- [ ] OpenAPI structural diff covers **every** endpoint incl. error/empty/degraded (DB-down 503, not-connected 200-empty) states; parity tests exhaustive.
  - *Verify:* `npm run test:parity` covers all endpoints + error/empty cases; OpenAPI diff clean for both backends vs canonical.
### P7.3 — Security review (connections/token handling)  *(type: BE)*
- [ ] Run the `security-review` skill over the connections/Plaid surface: encryption at rest, key handling, webhook verification, redirect-URI allowlist (no open redirect), no token/PII leakage.
  - *Verify:* findings triaged; criticals fixed before merge; documented in `pull_requests/`.

> **Deferred (own spec):** LangGraph + Gemini Flash Lite **analysis client**. **Open follow-up:** E*TRADE-direct adapter pending the P6.2 coverage check (DA-24).

---

## Appendix A — Canonical contract conventions (apply in BOTH backends; bake into `openapi.canonical.json`)

- **Error envelope (DA-1):** `{"error":{"code":string,"message":string,"details":[{"field":string,"location":string,"message":string,"code":string}]}}`. **Request validation → HTTP 422** on both (override NestJS `ValidationPipe` to 422 + this body; override FastAPI `RequestValidationError` handler to this body). Other codes reuse the envelope: `404 NOT_FOUND`, `409 CONFLICT`, `503 SERVICE_UNAVAILABLE`.
- **Money (DA-2):** decimal **string**, 2 dp, e.g. `"123.45"` / `"-45.00"`. FastAPI `Decimal`+serializer; NestJS `string` DTO; DB `NUMERIC(14,2)`. Never a JSON number.
- **Percentages/ratios (DA-22):** JSON **number**, 0–100, one decimal, e.g. `26.0`. Never a string, never 0–1.
- **Dates/datetimes (DA-3):** date = `YYYY-MM-DD`; datetime = ISO-8601 **UTC `Z`** (`2026-05-24T10:00:00Z`). Reject naive datetimes on input. DB `timestamptz`.
- **Pagination (DA-4):** offset/limit; response `{ "data":[…], "pagination":{ "limit","offset","total" } }`; defaults `limit=50` (max 200), `offset=0`. Never a top-level array.
- **Enums (DA-5):** string, lower_snake, identical values: `bucket{needs,wants,savings}`, `source{transactions,income,holdings,loans,listings}`, `source_mode{local,api}`, `item_status{connected,needs_reauth,error,disconnected,not_connected}`, `loan_priority{pay_first,then,minimums}`, `payoff_strategy{avalanche,minimums}`.
- **Null vs absent (DA-6):** responses **omit** absent optional fields (FastAPI `exclude_none`; NestJS drop `undefined`); required fields always present. Parity tests compare exact key presence.

## Appendix B — Exact gate commands

- **Python backend** (from `backend-python/`): `uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80`
- **TS backend** (from `backend-ts/`): `npm run lint && npm run format:check && npm run test:cov` (jest `coverageThreshold` global 80)
- **Frontend** (from `frontend/`): `npm run lint && npm run test -- --coverage` (vitest v8 ≥80) `&& npm run build`
- **Parity** (from `contracts/`): `npm run test:parity` + OpenAPI structural diff (both backends vs `openapi.canonical.json`) clean
- **Ingestion (root project)** (from repo root): `uv run pytest`
