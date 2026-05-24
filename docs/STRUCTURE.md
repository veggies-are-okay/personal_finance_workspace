# Repository Structure

> CHANGELOG
> - 2026-05-24: Initial structure. Foundation skeleton, rule/skill libraries, ingestion utilities. — Foundation pass.
> - 2026-05-24: Added `scripts/ledger.py` (multi-source normalizers + combined loader) and `tests/fixtures/` (synthetic CSV fixtures). — P0.3.
> - 2026-05-24: Added `docs/setup.md` (local Postgres bring-up via docker-compose). — P1.1.
> - 2026-05-24: Scaffolded `backend-python/app/` (FastAPI app, settings, DB wiring, `/health`) + Alembic (`backend-python/alembic/`). — P1.2.
> - 2026-05-24: Scaffolded `backend-ts/` (NestJS parity twin: `@nestjs/config`, global `ValidationPipe`, `@nestjs/swagger` OpenAPI at `/openapi.json`, TypeORM `synchronize: false`, `GET /health` → `{"status":"ok"}`). — P1.3.

Canonical source of truth for the repo layout. **Update this on every merge that adds/removes top-level dirs or key files** (same discipline as README — see `.claude/rules/structure-on-merge.md`).

## Top-level

```
personal_finance/
├── CLAUDE.md                  # Agent guidance (full briefing)
├── docker-compose.yml         # Shared Postgres
├── .env.example               # Env template (copy to .env; gitignored)
├── pyproject.toml             # ROOT uv project: data-prep utilities (scripts/ + tests/)
│
├── frontend/                  # React + Vite + Tailwind (TS) — backend-neutral via VITE_API_BASE_URL
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
├── contracts/                 # Canonical OpenAPI spec + cross-backend parity tests
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

Foundation stage. Built so far: skeleton, both backend project configs, rule + skill libraries, the Chase PDF extractor (`scripts/extract_chase_statements.py`), the **FastAPI backend scaffold** (`backend-python/app/` + Alembic) exposing `GET /health` (P1.2), and the **NestJS backend scaffold** (`backend-ts/`) exposing the same `GET /health` → `{"status":"ok"}` plus OpenAPI at `/openapi.json` (P1.3). The `frontend/` and `contracts/` trees are scaffolding placeholders pending the remaining P1+ phases in `plans/agent_checklist.md`.
