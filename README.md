# Personal Finance

A **local-first, single-user personal finance app**: budgeting, net-worth & investment tracking, transaction tracking, and debt/goal planning. It ingests your own bank/credit statements, normalizes them into one ledger, and serves budgeting / net-worth / planning views to a single frontend.

> Your real financial data is **gitignored** and never committed (`.claude/rules/data-privacy.md`). Everything tracked here uses **synthetic** fixtures.

## The defining idea: one frontend, two backends at 1:1 parity

There is **one frontend and two backends** kept at **strict 1:1 feature/API parity** — each feature is built twice, once in **Python/FastAPI** and once in **TypeScript/NestJS**, as a deliberate exercise in learning TS backends by direct comparison with FastAPI. A `contracts/` harness proves they stay identical.

```mermaid
flowchart TD
    FE["frontend/ — React + Vite + Tailwind<br/>(2 docker instances: 8501 → python · 8502 → ts)"]
    PY["backend-python/ — FastAPI + Pydantic v2"]
    TS["backend-ts/ — NestJS + class-validator"]
    DB["Shared Postgres<br/>(Alembic canonical · TypeORM mirrors)"]
    ING["scripts/ — statement ingestion + precompute"]
    C["contracts/ — canonical OpenAPI + parity tests"]
    FE -->|"VITE_API_BASE_URL"| PY
    FE -.->|"or"| TS
    PY --> DB
    TS --> DB
    ING --> DB
    C -. "asserts identical behavior" .-> PY
    C -. "asserts identical behavior" .-> TS
```

## Quickstart

### Run the whole stack with Docker (recommended)

One command brings up Postgres, **both** backends, and the **same** frontend built twice — one instance wired to each backend so you can compare them side by side:

```bash
docker compose up --build
# then open:
#   http://localhost:8501   frontend → backend-python (FastAPI)
#   http://localhost:8502   frontend → backend-ts     (NestJS)
```

Each frontend is an nginx container that serves the SPA and reverse-proxies `/api/` to its backend (same-origin, so no CORS). A one-shot `migrate` service runs `alembic upgrade head` (canonical schema) before the backends start. Copy `.env.example` → `.env` first for connector secrets (Plaid / encryption key); `DATABASE_URL` is set automatically inside the compose network.

**Port notes:** the backends are reachable through the frontend proxies (`/api/`) and are intentionally **not** published to the host (host `:8000` is often occupied). Postgres is published on **`5433`** (host `:5432` is often occupied); inside the network it is still `postgres:5432`. `docker compose down` keeps the `pf_pgdata` volume. See [`frontend/README.md`](frontend/README.md) for the nginx `/api` proxy model.

### Run components individually (dev)

```bash
# 1. Shared database
docker compose up -d postgres                          # Postgres (host :5433 → container :5432)

# 2. Python backend (FastAPI) — from backend-python/
uv sync && uv run alembic upgrade head && uv run uvicorn app.main:app --reload   # :8000

# 3. TypeScript backend (NestJS) — from backend-ts/
npm install && npm run start:dev                       # :3000

# 4. Frontend — from frontend/
npm install && npm run dev                             # :5173  (set VITE_API_BASE_URL to pick a backend)

# 5. Statement ingestion — from repo root
uv run python scripts/extract_chase_statements.py
```

Copy `.env.example` → `.env` (gitignored) and fill in `DATABASE_URL` and any connector keys.

## Repo map

| Path | What it is | README |
|------|------------|--------|
| [`frontend/`](frontend/README.md) | React + Vite + Tailwind; backend-neutral via `VITE_API_BASE_URL` | ✅ |
| [`backend-python/`](backend-python/README.md) | FastAPI service (uv, SQLAlchemy + Alembic — canonical schema) | ✅ |
| [`backend-ts/`](backend-ts/README.md) | NestJS service (npm, TypeORM mirrors schema) — parity twin | ✅ |
| [`contracts/`](contracts/README.md) | Canonical OpenAPI + cross-backend parity tests | ✅ |
| [`scripts/`](scripts/README.md) | Statement ingestion + precompute (root uv project) | ✅ |
| [`tests/`](tests/README.md) | Tests for `scripts/` (synthetic fixtures) | ✅ |
| [`docs/`](docs/README.md) | Committed markdown docs (+ gitignored real data) | ✅ |
| [`config/`](config/README.md) | `accounts.example.yaml` template (real `accounts.yaml` gitignored) | ✅ |
| [`plans/`](plans/README.md) | `agent_checklist.md` (task SSOT), `checklist_flow.md`, high-level plan | ✅ |
| `pencil/` | Pencil wireframes (`website_wire.pen`, synthetic) | — |
| `.claude/rules/`, `.claude/skills/` | Rule + skill libraries | — |

Canonical layout: [`docs/STRUCTURE.md`](docs/STRUCTURE.md). Roadmap: [`plans/agent_checklist.md`](plans/agent_checklist.md).

## Quality gates & contributing

`main` is protected — **PR-based merges only**, and all four CI checks must be green first:

| Gate | From | Command |
|------|------|---------|
| Python backend | `backend-python/` | `uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=80` |
| TS backend | `backend-ts/` | `npm run lint && npm run format:check && npm run test:cov` |
| Frontend | `frontend/` | `npm run lint && npm run test -- --coverage && npm run build` |
| Parity | `contracts/` | `npm run test:parity` + clean OpenAPI diff |

Conventions: branches `{yyyy}-{mm}-{dd}-<TYPE>/<slug>` (`.claude/rules/branching.md`); any API/behavior change lands in **both** backends + `contracts/` in one branch (`backend-parity.md`, **Rule #1**); PRs follow `.claude/rules/pull-requests.md` (tiered description + happy-path verification + README upkeep). Never commit real financial data (`data-privacy.md`).
