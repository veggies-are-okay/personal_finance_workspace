---
name: parity-auditor
description: Audits and restores STRICT 1:1 parity between the FastAPI (backend-python) and NestJS (backend-ts) backends of the personal-finance app. Diffs both OpenAPI specs, runs contracts/ parity tests, sends representative requests to both backends and diffs responses, compares the Alembic head schema with TypeORM entities, checks money/date/enum/null consistency, produces a severity-ranked drift report, and proposes minimal fixes applied in the SAME branch. Use when the user says "check parity," "audit parity," "are the backends in sync," before merging an API change, or after changing either backend.
---

# Parity Auditor

The personal-finance app has ONE frontend and TWO parallel backends kept at **STRICT 1:1 parity** (a learning exercise): **FastAPI** (`backend-python/`, package `app`, port 8000) and **NestJS** (`backend-ts/`, port 3000), sharing one Postgres. The canonical OpenAPI spec and cross-backend parity tests live in `contracts/`. Alembic (in `backend-python/`) owns the canonical schema; TypeORM entities (`synchronize:false`) must mirror it.

**RULE #1 BACKEND PARITY:** every route, request/response schema, validation rule, error shape, and HTTP status code is implemented IDENTICALLY in both backends. Money is consistent across Python (`Decimal`) and TS; dates/datetimes are ISO. This skill verifies that and, when drift is found, brings both backends back to 1:1 in the SAME branch.

**Data privacy:** real financial data is gitignored (`docs/bank_statements/`, `docs/gemini_investments_conversation/`, `images/`, `config/accounts.yaml`). NEVER put real values in the drift report, tests, or MCP queries — use synthetic/sample data.

## When to Use

- User says "check parity," "audit parity," "are the backends in sync," "diff the backends."
- Before merging any API change.
- After changing EITHER backend (route, schema, validation, error handling, migration, entity).
- When the frontend behaves differently depending on `VITE_API_BASE_URL` target (8000 vs 3000).

## Prerequisites

- Skim [docs/STRUCTURE.md](docs/STRUCTURE.md), [plans/agent_checklist.md](plans/agent_checklist.md), and recent `pull_requests/*.md` to know what changed.
- Have both backends runnable (Docker or local). Know the NestJS OpenAPI JSON path (`@nestjs/swagger`, commonly `/api/docs-json` or `/docs-json`).
- Findings go in `docs/qa.md` (and/or the relevant `pull_requests/<slug>.md`).

## What "parity" means here

| Dimension | Must match across FastAPI and NestJS |
|-----------|--------------------------------------|
| **Paths + methods** | Same URL paths (incl. `/api` prefix) and HTTP methods. |
| **Request schemas** | Same fields, required/optional, types, constraints (min/max/format), nullability. |
| **Response schemas** | Same field NAMES, types, formats, nullability, pagination shape. |
| **Validation rules** | Same constraints (Pydantic v2 vs class-validator) producing the same accept/reject decisions. |
| **Error shapes** | One agreed error body shape and the SAME HTTP status code (reconcile Pydantic 422 vs NestJS ValidationPipe 400). |
| **Status codes** | Identical success and failure status codes per endpoint. |
| **Money** | One agreed wire format (`Decimal` string vs number) and matching DB column type. |
| **Dates/datetimes** | ISO format + timezone identical (date vs datetime must agree). |
| **Enums** | Identical values (casing/spelling). |
| **DB schema** | TypeORM entities mirror the Alembic head (columns, types, nullability, defaults, indexes/constraints). |

## Workflow

### Step 1: Obtain OpenAPI from both backends and diff

```bash
# FastAPI canonical OpenAPI
curl -s http://localhost:8000/openapi.json -o /tmp/fastapi.openapi.json

# NestJS via @nestjs/swagger (adjust path to where the JSON is served)
curl -s http://localhost:3000/api/docs-json -o /tmp/nest.openapi.json 2>/dev/null \
  || curl -s http://localhost:3000/docs-json -o /tmp/nest.openapi.json

# Structural diff: paths + methods (no extra tooling)
python3 - <<'PY'
import json
a=json.load(open('/tmp/fastapi.openapi.json')); b=json.load(open('/tmp/nest.openapi.json'))
pa={(p,m.upper()) for p,ops in a.get('paths',{}).items() for m in ops}
pb={(p,m.upper()) for p,ops in b.get('paths',{}).items() for m in ops}
print("FastAPI-only:", sorted(pa-pb))
print("NestJS-only :", sorted(pb-pa))
print("Shared:", len(pa&pb))
PY
```

For a full semantic diff (schemas, params, status codes, error shapes), use an `openapi-diff` CLI. Ask **Perplexity** for the current recommended tool/version, then run it against both specs and against the canonical spec in `contracts/`. Treat any breaking diff as drift. Compare each shared operation's: parameters, request body schema, response schemas per status code, and documented error responses.

### Step 2: Run the contracts/ parity tests against both

```bash
cd contracts && npm run test:parity
```
These are the canonical cross-backend tests. A failure here is authoritative drift. If a new endpoint exists with no parity test, that is itself a finding (missing coverage) — note it and propose adding one.

### Step 3: Call BOTH backends with representative requests and diff responses

For each representative endpoint (happy path + at least one invalid payload), call both and diff status, relevant headers, and normalized JSON body.

```bash
# Happy path — same request to both, diff status + body
for base in http://localhost:8000 http://localhost:3000; do
  echo "=== $base GET /api/transactions ===";
  curl -s -o /tmp/b -w "status=%{http_code} ctype=%{content_type}\n" "$base/api/transactions";
  python3 -m json.tool /tmp/b 2>/dev/null | head -60;
done

# Invalid payload — compare status (422 vs 400?) and error body shape
for base in http://localhost:8000 http://localhost:3000; do
  echo "=== $base POST /api/transactions (bad) ===";
  curl -s -w "\nstatus=%{http_code}\n" -X POST "$base/api/transactions" \
    -H "Content-Type: application/json" -d '{}';
done
```

Normalize key ordering before comparing bodies (e.g. `python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])),sort_keys=True,indent=2))"`). Compare explicitly: field NAMES, types, formats (money string vs number; date vs datetime; timezone), nullability, enum values, and pagination shape. Use SYNTHETIC data only.

### Step 4: DB schema parity — Alembic head vs TypeORM entities

```bash
# Alembic canonical head
cd backend-python && uv run alembic heads && uv run alembic current

# Confirm TypeORM is NOT auto-syncing (must be false) and enumerate entities
grep -rn "synchronize" backend-ts/src 2>/dev/null
grep -rln "@Entity" backend-ts/src 2>/dev/null
```
Compare, table by table: column names, types, nullability, defaults, primary keys, unique constraints, indexes, and foreign keys. The Alembic migration is canonical; any TypeORM entity that diverges is drift. `synchronize:true` anywhere is a CRITICAL finding (TS would mutate the shared schema). For exact comparison, optionally dump the live schema (`docker compose exec postgres pg_dump -s -U postgres <db>`) and check both backends agree with it — never include real data, schema only.

### Step 5: Cross-language consistency

Check for the subtle divergences that OpenAPI alone may miss:
- **Money:** Does FastAPI serialize `Decimal` as a JSON string while NestJS emits a number (or vice-versa)? Pick ONE wire format and confirm both follow it; confirm the DB column type (e.g. `NUMERIC(precision, scale)`) matches on both sides.
- **Dates/datetimes:** Same ISO format and timezone? One side emitting `2026-05-24` and the other `2026-05-24T00:00:00Z` is drift.
- **Enums:** Identical values and casing in Pydantic models and class-validator DTOs.
- **Null handling:** Optional field omitted vs `null` vs default — must match.
- **Field naming:** snake_case vs camelCase consistency across both response bodies.

### Step 6: Produce the DRIFT REPORT (severity-ranked)

Write to `docs/qa.md` (and/or `pull_requests/<slug>.md`). No real financial data.

```markdown
# Parity Drift Report — <timestamp>

## Summary
<Are the backends in 1:1 parity? How many drifts, by severity. Parity tests + OpenAPI diff status.>

## Drifts (ordered CRITICAL → HIGH → MEDIUM → LOW)

### [CRITICAL/HIGH/MEDIUM/LOW] Drift Title
- **Dimension:** <path/method | request schema | response schema | validation | error shape | status code | money | date | enum | null | DB schema>
- **FastAPI side:** what it does (file + line)
- **NestJS side:** what it does (file + line)
- **Evidence:** OpenAPI diff fragment / parity test name / response diff / migration vs entity (sanitized)
- **Canonical answer:** which behavior is correct per contracts/ + the plan
- **Fix:** minimal change to bring both to 1:1 (which backend adapts, or both)
- **Files:** absolute paths in BOTH backends (+ Alembic migration / TypeORM entity if schema)

## In-Sync (verified parity)
<Endpoints/dimensions confirmed identical>

## Missing parity coverage
<Endpoints with no contracts/ parity test — propose adding>
```

Severity: **CRITICAL** = `synchronize:true`, schema mismatch that corrupts data, or an endpoint present in only one backend. **HIGH** = different status/error shape, money/date format mismatch on a live endpoint. **MEDIUM** = field naming/nullability/enum drift. **LOW** = doc/description-only differences.

### Step 7: Propose and apply minimal fixes (same branch)

- For each drift, propose the **minimal** change that restores 1:1, choosing the canonical behavior from `contracts/` and the plan (default: the canonical OpenAPI in `contracts/` and the Alembic schema win).
- Apply fixes in the **SAME branch** as the change that caused the drift — never let the backends sit out of sync across a merge.
- After fixing, RE-RUN the audit: OpenAPI diff clean, `npm run test:parity` green, response diffs match, Alembic↔TypeORM aligned.
- Re-run each touched backend's gate:
  - Python (from `backend-python/`): `uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80`
  - TS backend (from `backend-ts/`): `npm run lint && npm run format:check && npm run test:cov`
- If a fix changed the contract, update the canonical OpenAPI in `contracts/` and add/extend the relevant parity test.

## Outputs

| Output | Location |
|--------|----------|
| Severity-ranked drift report | `docs/qa.md` (and/or `pull_requests/<slug>.md`) |
| Applied fixes | Both backends in the same branch; `contracts/` updated if the contract changed |
| Re-audit result | OpenAPI diff clean + `npm run test:parity` green + Alembic↔TypeORM aligned |

## Quick Parity Check (copy-paste)

```bash
# 1. Both OpenAPI specs + path/method diff
curl -s http://localhost:8000/openapi.json -o /tmp/fastapi.openapi.json
curl -s http://localhost:3000/api/docs-json -o /tmp/nest.openapi.json 2>/dev/null \
  || curl -s http://localhost:3000/docs-json -o /tmp/nest.openapi.json
python3 - <<'PY'
import json
a=json.load(open('/tmp/fastapi.openapi.json')); b=json.load(open('/tmp/nest.openapi.json'))
pa={(p,m.upper()) for p,ops in a.get('paths',{}).items() for m in ops}
pb={(p,m.upper()) for p,ops in b.get('paths',{}).items() for m in ops}
print("FastAPI-only:", sorted(pa-pb)); print("NestJS-only :", sorted(pb-pa)); print("Shared:", len(pa&pb))
PY

# 2. Canonical parity tests
cd contracts && npm run test:parity

# 3. synchronize must be false
grep -rn "synchronize" backend-ts/src

# 4. Alembic head
cd backend-python && uv run alembic heads && uv run alembic current
```

## MCP Research Integration

- **Context7:** Resolve library IDs and query docs for `FastAPI` (OpenAPI generation, `/openapi.json`), `NestJS` / `@nestjs/swagger` (OpenAPI JSON), `Pydantic` (v2 422 error shape, Decimal serialization), `class-validator` / NestJS `ValidationPipe` (400 error shape), `SQLAlchemy`, `Alembic`, `TypeORM` (column types, `synchronize`). Use before assuming default error shapes or serialization behavior.
- **Perplexity:** For the current recommended `openapi-diff` CLI/tooling and known FastAPI↔NestJS interop pitfalls (Decimal/number, date/datetime, 422 vs 400). No secrets, no real financial data in queries.
