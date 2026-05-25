
# Backend Parity (Rule #1)

This project runs **two backends in parallel** — `backend-python/` (FastAPI) and `backend-ts/` (NestJS) — that must expose the **same API** and behave **identically**. This is a deliberate learning exercise: implementing each feature twice, once in Python and once in TypeScript, to understand TS backends through direct comparison with FastAPI.

**The parity invariant is the most important rule in this repo. Do not let the two backends drift.**

## What "parity" means

For every feature, both backends must match on:

- **Routes** — same path, same HTTP method, same path/query params.
- **Request schemas** — same field names, types, required/optional, defaults, and validation rules (Pydantic v2 ↔ class-validator DTOs).
- **Response schemas** — same field names, types, formats, nullability, and shape (including nested objects and arrays).
- **Status codes** — same success and error codes (200/201/204/400/404/409/422 …).
- **Error shape** — the JSON error body has the same structure across both backends. (FastAPI's default 422 differs from NestJS's `ValidationPipe` 400 — pick ONE canonical error contract and make both conform to it.)
- **Behavior** — same business logic, ordering, rounding, pagination, and edge-case handling.

Both backends read/write the **same Postgres schema**, so for the same request against the same data they must return the same response.

## The cardinal workflow rule

> **Any change to the API contract or backend behavior must land in BOTH backends, in the SAME branch, with the `contracts/` parity tests updated.**

- Branch type for contract/behavior changes is **`BE`** (both backends together) — see `.claude/rules/branching.md`.
- Use `BE-PY` / `BE-TS` **only** for backend-internal work that does not touch the shared contract (e.g. refactoring a Python service, swapping a TS utility) — and even then, confirm the externally observable behavior is unchanged.
- Never merge a branch that adds/changes an endpoint in one backend but not the other.

## Canonical contract & enforcement

- **`contracts/`** holds the canonical OpenAPI spec and the cross-backend **parity tests**.
- FastAPI publishes its schema at `/openapi.json`; NestJS publishes via `@nestjs/swagger`. These two documents must diff clean against the canonical spec.
- **Parity gate** (run from `contracts/`): `npm run test:parity` runs the contract test suite against **both** backends (start each, point the suite at its base URL) and asserts identical responses for the same requests. Plus an **OpenAPI diff** must be clean.
- Do **not** merge an API/behavior change unless: the Python gate passes, the TS gate passes, **and** the parity gate passes. See `.claude/rules/python.md`, `.claude/rules/typescript.md`.
- When in doubt, run the **`parity-auditor`** skill to detect and fix drift.

## Cross-language consistency (common drift sources)

- **Money:** Python uses `Decimal`; TS has no native decimal. Represent monetary amounts the same way on the wire (e.g. a decimal **string** or integer minor-units) so JSON bodies match exactly. Never let one backend emit `12.5` and the other `"12.50"`.
- **Dates/datetimes:** ISO-8601 strings on the wire in both backends; same precision and timezone handling.
- **Enums:** identical string values in both.
- **Null vs absent:** decide per field and apply it the same way in both backends.
- **Validation messages/codes:** align error `detail`/`message` structure so clients (and the parity tests) can't tell which backend answered.

## Python-owned ingestion (out of read parity, P8.1)

**Ingestion/extraction is Python-owned and intentionally OUT of the 1:1 read-parity contract — exactly like Alembic owning migrations.** Only the **read API** (the six view endpoints + connections) is held at strict parity.

- The upload/extract/load endpoints — `POST /api/v1/ingest/{source}`, `source ∈ {transactions, income, holdings, accounts, loans}` — exist in the **FastAPI backend ONLY**. They depend on Python-only libraries (pdfplumber for PDF statements/pay-stubs, PyYAML for `accounts.yaml`, pandas), so duplicating them in NestJS would add no learning value and a lot of drift risk.
- **NestJS does NOT implement `/ingest/*`,** and these paths are **NOT** in `contracts/openapi.canonical.json`.
- The parity harness **ignores `/api/v1/ingest/*`** when diffing the Python backend's `/openapi.json` against canonical (`isIngestPath()` / `INGEST_PATH_PREFIX` in `contracts/src/contract.ts`). A positive subset guard asserts the carve-out is the **only** allowed divergence: every other Python path must exist in canonical, and NestJS must expose none of the ingest paths — so genuine drift (an accidental extra read endpoint) still fails the gate.
- Pure extraction logic is the canonical `app/ingestion/` modules (`extract_chase.py`, `extract_paystubs.py`, `normalize_ledger.py`) so the containerized backend can run it; the repo-root `scripts/*` are thin CLI wrappers that import from `app`.

## Database schema parity

- **Alembic (Python) is the canonical owner of migrations.** The Postgres schema is defined and evolved there.
- **TypeORM runs with `synchronize: false`** and its entities **mirror** the Alembic-defined schema. A schema change is a `DB`-type branch that updates the Alembic migration **and** the TypeORM entities together.
- Never let TypeORM auto-sync alter the schema out from under Alembic.

## Definition of done for an API feature

1. Endpoint implemented in `backend-python/` (router + Pydantic schema + service) with tests ≥ 80%.
2. Endpoint implemented in `backend-ts/` (controller + DTO + service) with tests ≥ 80%.
3. `contracts/` updated: canonical OpenAPI entry + parity test covering success and error cases.
4. All three quality gates pass and the OpenAPI diff is clean.
5. If the schema changed: Alembic migration **and** TypeORM entity both updated.
