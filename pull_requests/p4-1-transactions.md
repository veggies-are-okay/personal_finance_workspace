# P4.1 — `GET /api/v1/transactions` (list/search/filter/paginate)

## Summary

The **first real view endpoint**, built in **both** backends at strict 1:1 parity
(`BE` branch). It also establishes the reusable patterns P4.2–P4.6 inherit:

- the **canonical error envelope** `{"error":{code,message,details[]}}` at HTTP **422**
  for request validation (DA-1) — reconciling FastAPI's default 422 and NestJS
  `ValidationPipe`'s default 400 to ONE shape;
- the **`Paginated<T>` envelope** `{data,pagination{limit,offset,total}}`, default
  `limit=50` (max 200), `offset=0` (DA-4);
- a **canonical 503** (same envelope) when the DB is unavailable (DA-18);
- Appendix A wire conventions: money decimal-**string**, dates `YYYY-MM-DD`, absent
  optional fields **omitted** (DA-6).

Both backends serve a thin read of the `transactions` table (LEFT JOIN `accounts` for
the name) — no recompute. The canonical OpenAPI was **not** edited (frozen, DA-25); the
path was flipped on in `IMPLEMENTED_PATHS` so the structural diff now covers it.

## Changes (Large — by realm)

- **backend-python/ (FastAPI):** `app/errors.py` — canonical envelope + handlers
  (`RequestValidationError`→422, `ServiceUnavailableError`→503). `app/routers/transactions.py`
  — the endpoint (Pydantic query/response models, filters `date_from`/`date_to`/`account`/
  `category`/`q`, offset/limit pagination, `total` ignoring pagination). `app/schemas.py` —
  `Transaction`/`Pagination`/`PaginatedTransactions`/`TransactionQuery` (money serializer,
  `exclude_none`). `app/main.py` registers handlers + router. Tests: `tests/test_transactions.py`.
- **backend-ts/ (NestJS):** `src/errors/` — `CanonicalExceptionFilter` + `canonicalValidationExceptionFactory`
  (422). `src/transactions/` — controller + query DTO (class-validator) + TypeORM service.
  `app.module.ts` gained a **resilient `dataSourceFactory`** (+ `manualInitialization`) so a
  DB-down boot still serves `/health` and 503s DB routes — matching FastAPI's lazy engine
  (DA-18). `main.ts` wires the global filter + 422 pipe. Tests: service/controller/DTO specs,
  filter + factory specs, `test/transactions.e2e-spec.ts`.
- **contracts/:** `test/transactions.parity.test.ts` (success / 422 / offset-past-end / 503),
  `src/db.ts` (synthetic seed), `src/backends.ts#startDbDownBackends`, `IMPLEMENTED_PATHS`
  += the path. `openapi.canonical.json` untouched.
- **docs/READMEs:** `backend-python`, `backend-ts`, `contracts` READMEs + `docs/STRUCTURE.md`;
  P4.1 ticked in `plans/agent_checklist.md`.

## Feature mapping

Powers the **Transactions** screen (and the Budget screen's transaction drill-downs) per
`docs/2026-05-24-data-connectors-and-frontend-design.md` §3 — the paginated, filterable
ledger list the frontend renders.

## Happy-path verification

Both backends booted against a seeded **synthetic** DB return the **same** body for
`GET /api/v1/transactions?account=Checking` (byte-equal after key-sort) and the same
canonical 422 for an invalid query:

![P4.1 identical transactions response (FastAPI + NestJS)](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/0c87f851c05c745e2f2a34134cdcb14075813cee/pull_requests/evidence/p4-1-transactions/proof.png)

## Test plan (gate results)

- **Python** (`backend-python/`): `ruff check` + `ruff format --check` clean;
  `pytest --cov=app --cov-fail-under=80` → **126 passed, 99% coverage**.
- **TS** (`backend-ts/`): `lint` + `format:check` clean; `test:cov` → **81 passed, 99.5%
  coverage** (global ≥80%).
- **Parity** (`contracts/`): `npm run test:parity` → **51 passed** (incl. the 4 new
  transactions cases) + structural OpenAPI diff clean for the implemented paths.
- **Frontend:** untouched (n/a).

All fixtures are synthetic; no real financial data anywhere.

## Checklist

- [x] Endpoint in **both** backends at 1:1 parity (route/params/response/status/errors).
- [x] `contracts/` parity test covers success + DA-1 (422) + DA-4 (offset past end) + DA-18 (503).
- [x] Canonical OpenAPI **not** edited (DA-25); `IMPLEMENTED_PATHS` updated; diff clean.
- [x] Money decimal-string, dates `YYYY-MM-DD`, omit-absent (DA-6).
- [x] All three gates green (≥80% coverage each); READMEs + `docs/STRUCTURE.md` updated.
