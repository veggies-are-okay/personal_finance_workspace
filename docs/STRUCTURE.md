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
│   │                          #     Session/Base/get_db, psycopg3) · schemas.py (HealthResponse) ·
│   │                          #     main.py (create_app, CORS, GET /health)
│   ├── alembic/               #   Migrations: env.py reads DATABASE_URL via app.config; versions/ (empty until P2.1)
│   ├── alembic.ini            #   Alembic config (URL resolved in env.py; no secrets here)
│   └── tests/                 #   conftest (TestClient) + test_health/test_config/test_db (≥80% cov on app)
├── backend-ts/                # NestJS + TypeORM + class-validator (npm); parity twin of backend-python
│   ├── src/                   #   main.ts (bootstrap: global ValidationPipe, Swagger → /openapi.json,
│   │                          #     listens on TS_API_PORT) · app.module.ts (ConfigModule reads repo-root
│   │                          #     .env, TypeOrmModule.forRootAsync postgres synchronize:false retryAttempts:0,
│   │                          #     buildTypeOrmOptions) · health/ (module · controller · service ·
│   │                          #     health-response.dto.ts + *.spec.ts unit tests)
│   ├── test/                  #   health.e2e-spec.ts (Supertest; DataSource overridden → boots without a DB)
│   ├── package.json           #   scripts: lint · format:check · test:cov (Jest+SWC, ≥80% global) · start:dev · build
│   ├── tsconfig*.json          #   strict TS; nest-cli.json · eslint.config.mjs · .prettierrc
│   └── .gitignore             #   node_modules/ · dist/ · coverage/ (also covered by root .gitignore)
├── contracts/                 # Cross-backend PARITY HARNESS (Node + Vitest) — enforces Rule #1
│   ├── openapi.canonical.json #   Canonical contract — COMPLETE + FROZEN (P2.2/DA-25): all view +
│   │                          #     source + connections paths + /health; Appendix A baked in
│   │                          #     (Money string, Percentage number, Error envelope, Pagination, enums)
│   ├── redocly.yaml           #   redocly lint config (recommended ruleset, tuned for a local-first app)
│   ├── src/                   #   backends.ts (spawn/poll/teardown both backends; rogue-:8000 guard) ·
│   │                          #     global-setup.ts (Vitest globalSetup) · normalize.ts (OpenAPI
│   │                          #     structural normalizer) · contract.ts (canonical loader +
│   │                          #     IMPLEMENTED_PATHS allowlist) · http.ts
│   ├── test/                  #   health-response.parity · openapi.parity (structural diff, scoped to
│   │                          #     implemented paths) · endpoints.parity.stubs (it.todo per endpoint) ·
│   │                          #     normalize.unit · contract.unit · backends.unit
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
