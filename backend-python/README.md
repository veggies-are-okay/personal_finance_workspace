# backend-python (FastAPI)

**Purpose:** the FastAPI service and the **canonical** half of the dual-backend pair. It owns the **canonical database schema** via Alembic migrations; `backend-ts/` (NestJS) mirrors that schema and must behave identically (`.claude/rules/backend-parity.md`, **Rule #1**).

## Run & test (from `backend-python/`)

```bash
uv sync
uv run alembic upgrade head           # apply the canonical schema
uv run uvicorn app.main:app --reload  # serves on :8000 (TS twin uses :3000)
```

Quality gate (CI `python-backend` job):

```bash
uv run ruff check . && uv run ruff format --check . && \
  uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
```

## Key files

| Path | Role |
|------|------|
| `app/main.py` | `create_app`, CORS, canonical exception handlers, routers (`GET /health`, `GET /api/v1/transactions`; more view/source/connections routes per the checklist). |
| `app/config.py` | Settings via `pydantic-settings` (reads repo-root `.env`). |
| `app/db.py` | SQLAlchemy 2.0 engine/session/`Base`/`get_db` (psycopg3). |
| `app/errors.py` | **Canonical error envelope + handlers (P4.1, DA-1/DA-18):** maps `RequestValidationError` → **422** and `ServiceUnavailableError` → **503**, both in the one `{"error":{code,message,details[]}}` shape NestJS also emits. Registered by `create_app`; every view router inherits it. |
| `app/routers/transactions.py` | **`GET /api/v1/transactions` (P4.1):** thin read of `transactions` (LEFT JOIN `accounts` for the name) with date/account/category/`q` filters + offset/limit pagination → the `Paginated<T>` envelope. Money decimal-string, dates `YYYY-MM-DD`; DB failure → canonical 503. |
| `app/models.py` | SQLAlchemy 2.0 ORM models — the **canonical schema** (P2.3): accounts, transactions (+enrichment), categories, budgets, loans, goals, holdings, `budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges`, `plaid_items` (token `BYTEA`), `source_config`, and the P3.2 `paystubs` income table. |
| `app/schema_export.py` | Dumps a normalized schema snapshot (`python -m app.schema_export`) for the cross-backend schema-parity check (DA-8). |
| `app/ingestion/loader.py` | **Idempotent ledger loader (P3.1):** upserts the normalized signed-amount ledger into `transactions` on the unique `dedupe_key` (`sha256(account, date, signed_amount, normalized_description)` — DA-19). Re-import is an upsert, not a duplicate. Money is `Decimal`. Consumes the rows `scripts/ledger.py` emits. |
| `app/ingestion/income_loader.py` | **Idempotent income loader (P3.2):** upserts parsed pay stubs into `paystubs` on the unique `dedupe_key` (`sha256(employer, pay_date, gross_pay, net_pay)` — DA-19). Consumes the dict/`PaystubRow` rows `scripts/extract_paystubs.py` emits. |
| `app/precompute/` | **Deterministic analytics precompute (P3.2, Python only):** reads `transactions` (+ `paystubs` income) → generic categorization + transfer/recurring detection + 50/30/20 buckets + savings/effective-tax rates (numeric 0–100) and writes `budget_aggregates` + `budget_{bucket,category,monthly}_aggregates` + `recurring_charges` (every `/api/v1/budget` field — DA-23). `run_precompute(session, window=...)` is the entry point; idempotent re-run. **No categorization logic in TypeScript** — both backends only READ these tables (DA-9). |
| `app/schemas.py` | Pydantic v2 response/request models (must match the canonical OpenAPI). |
| `alembic/` | Migrations — the **canonical schema source**; `versions/f0bda61fcf45_*` is the P2.3 initial schema, `versions/ba4cb087cce7_*` adds the P3.2 `paystubs` income table. |

## How it fits

Serves **thin reads** of tables the ingestion pipeline precomputes — it does **not** recompute categorization/aggregates (that keeps parity with NestJS trivial). Every API/behavior change must land here **and** in `backend-ts/` in the same branch, with a `contracts/` parity test and a clean OpenAPI diff.

The raw→normalized-CSV **normalizers** live in the repo-root `scripts/` project; the **DB-writing loader/precompute** live here (`app/ingestion/` + `app/precompute/`) so they run under the `python-backend` CI gate and reuse `app.models`/`app.db`. `app/ingestion/loader.py` (ledger) and `app/ingestion/income_loader.py` (pay stubs) upsert idempotently; `app/precompute/run_precompute` then enriches `transactions` and writes the `/budget` aggregate tables. These DB-touching tests run against the live Postgres service (`docker compose up -d`, then `uv run alembic upgrade head`).

**Gotchas:**
- This is one of **two uv projects** — run these commands from `backend-python/` (the repo root is the *ingestion* uv project).
- **Money is `Decimal` → serialized as a decimal string** on the wire; **datetimes are ISO-8601 UTC `Z`**; validation errors use the canonical **422** envelope (contract Appendix A). Keep Alembic and the TypeORM entities in lockstep (`synchronize:false`).
- **Schema column types** (Appendix A): money `NUMERIC(14,2)`, percentages bare `NUMERIC`, datetimes `timestamptz`, enums `TEXT` + `CHECK`, the Plaid `access_token` is `BYTEA` (ciphertext — never plaintext). Importing `app.models` registers tables on `Base.metadata`; `alembic check` must report no drift between the models and the migration.
