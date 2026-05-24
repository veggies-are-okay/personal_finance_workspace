---
name: bug-hunter
description: Systematic, layer-by-layer debugger for the dual-backend personal-finance app (React/Vite frontend + parallel FastAPI and NestJS backends sharing one Postgres). Runs diagnostic bash across infrastructure, both backends, backend parity, frontend, and statement ingestion, then produces a prioritized bug report (CRITICAL/HIGH/MEDIUM/LOW). Uses Context7 and Perplexity tailored to this stack. Use when the user says "debug," "hunt bugs," "something is broken," or "run bug-hunter."
---

# Bug Hunter

Systematic, stack-aware debugging skill for the local-first personal-finance app. The app has ONE frontend and TWO parallel backends kept at STRICT 1:1 parity (FastAPI and NestJS), sharing one Postgres. Walk through every architectural layer, run diagnostics, and produce a prioritized bug report with fix suggestions.

**Data privacy:** real financial data is gitignored (`docs/bank_statements/`, `docs/gemini_investments_conversation/`, `images/`, `config/accounts.yaml`). NEVER print real values into the report, tests, or MCP queries. Use synthetic/sample data for any reproduction.

## When to Use

- User says "debug," "hunt bugs," "find bugs," "something is broken," "run bug-hunter," or describes a specific symptom.
- After a `docker compose up` that isn't working.
- Before a PR merge to smoke-test the running system.
- When a checklist phase produces unexpected test failures.
- When the two backends disagree (parity drift suspected).

## Prerequisites

- Read [plans/agent_checklist.md](plans/agent_checklist.md) and [plans/first_pass_high_level_plan.md](plans/first_pass_high_level_plan.md) and skim [docs/STRUCTURE.md](docs/STRUCTURE.md) for architectural context.
- Skim recent `pull_requests/*.md` to understand what changed recently. Log findings/QA in `docs/qa.md`.
- Have Docker running if doing live diagnostics (optional — static analysis works without Docker).

## Stack Reference

| Layer | Tech | Key Locations |
|-------|------|---------------|
| **Orchestration** | Docker Compose | `docker-compose.yml` (root) |
| **Database** | Postgres (shared, port 5432) | `docker-compose.yml`, both backends connect via `DATABASE_URL` |
| **Backend (Python)** | FastAPI + Pydantic v2, uv, SQLAlchemy 2.0 + Alembic | `backend-python/app/` (package `app`), `backend-python/alembic/`. Port 8000 |
| **Backend (TS)** | NestJS + TypeORM + class-validator, npm | `backend-ts/src/` (`synchronize:false`). Port 3000 |
| **Contracts/Parity** | Canonical OpenAPI + cross-backend parity tests | `contracts/` |
| **Frontend** | React + Vite + Tailwind (TS) | `frontend/src/`. Port 5173. Backend-neutral via `VITE_API_BASE_URL` |
| **Statement ingestion** | Parsers (per source) | parser modules under each backend / `scripts/` |

**Ports:** 8000 FastAPI · 3000 NestJS · 5173 Vite · 5432 Postgres.

## Workflow

### Layer 0: Triage — Understand the Symptom

1. **Ask or infer** the symptom category:
   - App won't start / containers crash
   - API returns errors (4xx, 5xx) — and from WHICH backend (8000 vs 3000)?
   - Frontend can't reach backend (CORS, network, wrong `VITE_API_BASE_URL`)
   - The two backends disagree (same request, different status/body) — parity drift
   - DB errors / migration not applied
   - Statement import wrong (sums off, duplicates, sign flipped)
   - Tests failing (which gate: Python, TS, frontend, parity?)
   - "Something is off" (no specific symptom)

2. **If no specific symptom**, run all layers below in order. If a specific symptom is given, jump to the relevant layer but still run Layer 1 (infrastructure) first since it cascades everywhere. If a backend behaves differently from the other, always run Layer 4 (parity drift).

### Layer 1: Infrastructure — Docker, Postgres, Ports, Env

**Common bugs in this stack:**
- `DATABASE_URL` uses `localhost` instead of the `postgres` service name **inside containers** (and vice-versa — must be `localhost:5432` when run from the host).
- Port conflicts: 8000 (FastAPI), 3000 (NestJS), 5173 (Vite), 5432 (Postgres) already in use.
- `.env` file missing or not copied from `.env.example` for either backend.
- Postgres healthy but migrations not applied (Alembic not run) → tables missing, both backends 500.
- Both backends pointed at different databases/schemas by accident.

**Diagnostic steps:**
```bash
# 1. Check .env presence + required vars (no secrets printed; just names)
grep -hE "^(DATABASE_URL|VITE_API_BASE_URL|JWT_SECRET|PORT)" \
  backend-python/.env backend-ts/.env frontend/.env 2>/dev/null \
  | sed 's/=.*/=<set>/' || echo "MISSING .env in one or more services"

# 2. Containers running?
docker compose ps

# 3. Crash-loop logs
docker compose logs --tail=50 postgres
docker compose logs --tail=50 backend-python 2>/dev/null || docker compose logs --tail=50 api
docker compose logs --tail=50 backend-ts 2>/dev/null || docker compose logs --tail=50 nest

# 4. Postgres reachable?
docker compose exec postgres pg_isready -U postgres

# 5. Port conflicts on the host
lsof -i :8000 -i :3000 -i :5173 -i :5432 2>/dev/null

# 6. Are Alembic migrations applied? (canonical schema)
docker compose exec backend-python sh -lc "cd /app && uv run alembic current" 2>/dev/null \
  || (cd backend-python && uv run alembic current)
```

**Key env var gotchas:**
- `DATABASE_URL` host = `postgres` (Docker service name) **inside containers**; `localhost` when run from the host.
- Both backends MUST point at the SAME Postgres database (parity depends on shared schema/data).
- `VITE_API_BASE_URL` is baked into the frontend at **build time** — changing it requires a rebuild, not just a restart.
- Missing `JWT_SECRET` (if auth is enabled) crashes startup or breaks token verification on either backend.

### Layer 2: backend-python (FastAPI + Pydantic v2 + SQLAlchemy + Alembic)

**Common bugs in this stack:**
- **CORS:** frontend origin (`http://localhost:5173`) not in `CORSMiddleware` `allow_origins`; preflight blocked → frontend sees opaque `TypeError: Failed to fetch`.
- **Route prefix:** routers mounted at `/api` — frontend or parity test calling without the prefix → 404.
- **Pydantic v2 422 shape:** validation errors return 422 with `{"detail": [{"loc","msg","type"}, ...]}`. Frontend must parse `detail`. This shape MUST be reconciled with NestJS (Layer 4).
- **SQLAlchemy session lifecycle:** `get_db()` dependency must `yield` then close; leaks/`DetachedInstanceError` if sessions are mishandled or the generator doesn't close on the exception path.
- **Alembic:** migrations not applied → `UndefinedTable`; or migration head differs from what the models expect.
- **Lifespan** errors silently swallowed → app "up" but DB engine never connected.

**Diagnostic steps:**
```bash
# 1. Is FastAPI responding?
curl -s http://localhost:8000/health 2>/dev/null | python3 -m json.tool || echo "FastAPI /health down"

# 2. CORS preflight from the Vite origin
curl -s -X OPTIONS http://localhost:8000/api/transactions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" -i 2>&1 | grep -i "access-control"

# 3. Route registration + prefix
docker compose exec backend-python python -c "from app.main import app; [print(r.path, getattr(r,'methods',None)) for r in app.routes]" \
  2>/dev/null || (cd backend-python && uv run python -c "from app.main import app; [print(r.path, getattr(r,'methods',None)) for r in app.routes]")

# 4. Pydantic v2 422 shape on a bad payload
curl -s -X POST http://localhost:8000/api/transactions \
  -H "Content-Type: application/json" -d '{}' | python3 -m json.tool

# 5. Alembic head vs current
cd backend-python && uv run alembic heads && uv run alembic current

# 6. Python quality gate (from backend-python/)
cd backend-python && uv run ruff check . && uv run ruff format --check . && \
  uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
```

**Cascade effects:**
- 503 from `/health` means DB is down — everything downstream fails.
- CORS preflight failure → frontend `Failed to fetch` with no useful error.
- 422 body shape divergence from NestJS is a PARITY bug (Layer 4), not just a frontend bug.

### Layer 3: backend-ts (NestJS + TypeORM + class-validator)

**Common bugs in this stack:**
- **Global prefix:** `app.setGlobalPrefix('api')` must match FastAPI's `/api` prefix — otherwise paths diverge (parity drift).
- **ValidationPipe 400 shape:** NestJS `ValidationPipe` returns **400** by default with `{"statusCode","message":[...],"error"}`, whereas Pydantic returns **422** with `{"detail":[...]}`. These MUST be reconciled to ONE agreed status + body (Layer 4). Decide which side adapts and make it explicit.
- **TypeORM datasource:** `synchronize:false` is REQUIRED (Alembic owns the schema). If `synchronize:true` sneaks in, TS will mutate the shared DB and break parity.
- **Entities not registered:** missing entity in `entities`/module `forFeature` → `EntityMetadataNotFoundError`.
- **DI / module wiring:** provider not in `providers` or not exported → `Nest can't resolve dependencies`.
- **CORS:** `app.enableCors({ origin: 'http://localhost:5173' })` must allow the Vite origin.

**Diagnostic steps:**
```bash
# 1. Is NestJS responding?
curl -s http://localhost:3000/api/health 2>/dev/null | python3 -m json.tool || echo "NestJS health down"

# 2. ValidationPipe 400 shape on a bad payload
curl -s -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" -d '{}' | python3 -m json.tool

# 3. CORS preflight from the Vite origin
curl -s -X OPTIONS http://localhost:3000/api/transactions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" -i 2>&1 | grep -i "access-control"

# 4. Confirm synchronize:false (must be false)
grep -rn "synchronize" backend-ts/src backend-ts/*.ts 2>/dev/null

# 5. App boots / DI resolves (look for "Nest can't resolve dependencies")
docker compose logs --tail=80 backend-ts 2>/dev/null | grep -iE "error|can't resolve|EntityMetadataNotFound" || true

# 6. TS backend quality gate (from backend-ts/)
cd backend-ts && npm run lint && npm run format:check && npm run test:cov
```

**Cascade effects:**
- `synchronize:true` silently mutating the shared DB is a CRITICAL parity + data-integrity bug.
- Global prefix mismatch makes every path differ from FastAPI → mass parity drift.

### Layer 4: BACKEND PARITY DRIFT (the headline failure mode)

**RULE #1:** every route, request/response schema, validation rule, error shape, and HTTP status code must be IDENTICAL across FastAPI and NestJS. Diff aggressively.

**Common parity bugs:**
- Path/method present in one backend, missing in the other.
- Same validation failure → 422 (FastAPI) vs 400 (NestJS); different error body shapes.
- Field name casing differs (`created_at` vs `createdAt`); nullability differs.
- Money: FastAPI emits `Decimal` as a JSON string vs NestJS emits a number (or vice-versa).
- Date/datetime: one emits `2026-05-24` vs `2026-05-24T00:00:00Z`; timezone differs.
- Enum value casing/spelling differs.
- One backend's DB writes don't match the Alembic schema (TypeORM entity drift).

**Diagnostic steps:**
```bash
# 1. Pull both OpenAPI specs
curl -s http://localhost:8000/openapi.json -o /tmp/fastapi.openapi.json
# NestJS: @nestjs/swagger — adjust path to wherever the JSON is served (e.g. /api/docs-json)
curl -s http://localhost:3000/api/docs-json -o /tmp/nest.openapi.json 2>/dev/null \
  || curl -s http://localhost:3000/docs-json -o /tmp/nest.openapi.json

# 2. Diff paths + methods (quick structural check, no extra tooling)
python3 - <<'PY'
import json
a=json.load(open('/tmp/fastapi.openapi.json')); b=json.load(open('/tmp/nest.openapi.json'))
pa={(p,m.upper()) for p,ops in a.get('paths',{}).items() for m in ops}
pb={(p,m.upper()) for p,ops in b.get('paths',{}).items() for m in ops}
print("FastAPI-only:", sorted(pa-pb))
print("NestJS-only :", sorted(pb-pa))
print("Shared count:", len(pa&pb))
PY

# 3. Run the canonical parity test suite (from contracts/)
cd contracts && npm run test:parity

# 4. Send the SAME request to BOTH backends and diff status + body
for base in http://localhost:8000 http://localhost:3000; do
  echo "=== $base ===";
  curl -s -o /tmp/body -w "status=%{http_code}\n" "$base/api/transactions";
  python3 -m json.tool /tmp/body 2>/dev/null | head -40;
done

# 5. Diff error shapes on the same bad payload (422 vs 400, body keys)
for base in http://localhost:8000 http://localhost:3000; do
  echo "=== $base (bad payload) ===";
  curl -s -w "\nstatus=%{http_code}\n" -X POST "$base/api/transactions" \
    -H "Content-Type: application/json" -d '{}';
done
```

**What to compare explicitly:** HTTP status, relevant headers (`content-type`), JSON body field NAMES, types, formats (money string vs number; date vs datetime; timezone), nullability, enum values, and pagination shape. Normalize key ordering before comparing bodies. For deep OpenAPI diffing, use an openapi-diff tool (ask Perplexity for the current recommended CLI) and treat any breaking diff as a bug.

### Layer 5: Frontend — React + Vite + Tailwind

**Common bugs in this stack:**
- `VITE_API_BASE_URL` not set or wrong; it is **baked at build time** → changing the backend target requires a rebuild.
- Pointed at the wrong backend (8000 vs 3000) → looks like a backend bug but is config.
- fetch/CORS errors surface as `TypeError: Failed to fetch` with no detail (the real cause is usually Layer 2/3 CORS).
- Auth token handling: stored only in memory (lost on refresh) or not attached as `Authorization: Bearer`.
- Missing error / loading / empty states → blank screen instead of a useful message.

**Diagnostic steps:**
```bash
# 1. Is Vite serving?
curl -s http://localhost:5173/ | head -5

# 2. Which API base did the build bake in?
grep -ron "VITE_API_BASE_URL" frontend/dist 2>/dev/null | head
grep -rn "VITE_API_BASE_URL" frontend/src frontend/.env* 2>/dev/null

# 3. Frontend quality gate (from frontend/)
cd frontend && npm run lint && npm run test -- --coverage

# 4. Browser console + network (use Playwright MCP):
#    navigate to http://localhost:5173, then check mcp__playwright__browser_console_messages
#    and mcp__playwright__browser_network_requests for failed fetches / CORS / 4xx-5xx.
```
Use the Playwright MCP tools to load the app, capture console errors, and inspect failed network requests — this catches CORS and base-URL bugs the curl checks can miss.

### Layer 6: Statement Ingestion

**Common bugs in this stack:**
- **Sign conventions per source:** different statement sources encode debits/credits differently (negative vs positive, separate columns). A flipped sign corrupts balances.
- **Money as Decimal:** parse to `Decimal` (Python) / exact representation (TS) — never float. Rounding drift breaks the invariant below.
- **Year inference:** statements that omit the year (e.g. "05/24") must infer it correctly across year boundaries (December → January).
- **Idempotent re-import:** re-importing the same statement must NOT create duplicate transactions (dedupe on a stable key).
- **Invariant:** the sum of parsed line items MUST equal the printed statement total. Assert `parsed_sum == printed_total` (within zero tolerance for Decimal).

**Diagnostic steps (use SAMPLE/synthetic data only — never real statements):**
```bash
# 1. Run ingestion/parser tests
cd backend-python && uv run pytest -k "ingest or statement or parse" -q --tb=short
cd backend-ts && npx jest --testPathPattern "ingest|statement|parse" 2>/dev/null || true

# 2. Check the parsed-sum == printed-total invariant is asserted in tests
grep -rn "parsed_sum\|printed_total\|== total\|invariant" backend-python/app backend-ts/src scripts 2>/dev/null

# 3. Re-import idempotency: look for a dedupe key / unique constraint
grep -rni "idempoten\|dedupe\|unique\|on conflict" backend-python/app backend-ts/src 2>/dev/null
```
NEVER paste real statement contents or amounts into the report or any MCP query.

## Output Format

After running diagnostics, produce a structured, prioritized report (no real financial data):

```markdown
# Bug Hunter Report — <timestamp>

## Summary
<1-2 sentence overview: how many issues found, severity breakdown, whether parity is intact>

## Issues Found (ordered CRITICAL → HIGH → MEDIUM → LOW)

### [CRITICAL/HIGH/MEDIUM/LOW] Issue Title
- **Layer:** <infrastructure / backend-python / backend-ts / parity / frontend / statement-ingestion>
- **Symptom:** What the user sees
- **Root Cause:** What's actually wrong
- **Evidence:** Command output or code reference (sanitized — no real money/PII)
- **Fix:** Specific code change or config fix; for API/schema/error/status changes, the fix MUST land in BOTH backends
- **Files:** Absolute paths to modify (both backends if parity-related; Alembic migration + TypeORM entity if schema-related)

## Healthy Layers
<Layers that passed all checks>

## Parity Status
<OpenAPI diff result, contracts/ parity test result, any money/date/enum/status mismatches>

## Recommendations
<Preventative measures, missing tests, monitoring suggestions>
```

Severity guidance: **CRITICAL** = app down, data corruption, or `synchronize:true` mutating the shared DB. **HIGH** = parity drift on a live endpoint, broken auth, wrong money/sign. **MEDIUM** = inconsistent error shape, missing edge-case handling. **LOW** = cosmetic, missing states, lint.

## MCP Research Integration

- **Context7:** Resolve library IDs and query docs for `FastAPI`, `Pydantic`, `SQLAlchemy`, `Alembic`, `pytest`, `NestJS`, `class-validator`, `TypeORM`, `Jest`, `Supertest`, `React`, `Vite`, `Vitest`, `Tailwind`, `PostgreSQL`, and OpenAPI/Swagger (`@nestjs/swagger`). Use before guessing at API behavior, error-shape defaults (422 vs 400), or config.
- **Perplexity:** For error messages you don't recognize, recent breaking changes, Docker/infra issues, or to find the current recommended `openapi-diff` CLI. No secrets, no real financial data in queries.

## Quick Health Check (copy-paste)

```bash
# Quick health check — all services + parity (run from project root)
docker compose ps && \
curl -sf http://localhost:8000/health   > /dev/null && echo "FastAPI OK" && \
curl -sf http://localhost:3000/api/health > /dev/null && echo "NestJS OK" && \
curl -sf http://localhost:5173/          > /dev/null && echo "Frontend OK" && \
docker compose exec postgres pg_isready -U postgres && \
echo "=== Core services responding ==="

# Per-backend + frontend + parity quality gates
cd backend-python && uv run ruff check . && uv run ruff format --check . && \
  uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
cd backend-ts && npm run lint && npm run format:check && npm run test:cov
cd frontend && npm run lint && npm run test -- --coverage
cd contracts && npm run test:parity   # plus a clean OpenAPI diff

# Scan all container logs for errors
docker compose logs --tail=20 2>&1 | grep -iE "error|exception|traceback|failed|fatal|can't resolve"
```
