# contracts/ — cross-backend parity harness

This project **enforces Rule #1** (`.claude/rules/backend-parity.md`): the FastAPI
backend (`backend-python/`) and the NestJS backend (`backend-ts/`) must expose the
**same API** and behave **identically**. The harness boots both backends, hits them
with the same requests, and asserts their responses — and their OpenAPI documents —
agree, both with each other and with a canonical contract.

It is **type=INFRA**: it changes neither backend's API. It only compares them.

## The gate

```bash
cd contracts
npm install        # once
npm run test:parity
```

`npm run test:parity` is the canonical parity gate the rest of the project calls.
It is **self-contained**:

1. **`pretest:parity`** runs `build:backends`: `uv sync` for `backend-python/`,
   `npm install && npm run build` for `backend-ts/`. (Run it manually any time via
   `npm run build:backends`.)
2. Vitest **global setup** (`src/global-setup.ts`) spawns BOTH backends on
   dedicated **free** ports, then polls each `/health` (bounded retry, no infinite
   wait) until it returns **our real body** `{"status":"ok"}`.
3. The parity tests run.
4. Global setup **teardown** kills both child process trees — even on failure.

| Backend          | Command (cwd)                                              | Port   |
| ---------------- | ---------------------------------------------------------- | ------ |
| FastAPI (Python) | `uv run uvicorn app.main:app --port 8765` (`backend-python/`) | `8765` |
| NestJS (TS)      | `node dist/main.js` with `TS_API_PORT=3765` (`backend-ts/`) | `3765` |

### Port hygiene / the :8000 trap

Port **8000** on this machine is held by an **unrelated** process that returns
`{"status":"healthy"}` — NOT our app. The harness deliberately uses **8765 / 3765**
and the health poll **fails loudly** if it ever sees `{"status":"healthy"}` (or any
body other than `{"status":"ok"}`), so a misconfigured port can't silently pass.

### Running several parity suites in parallel

The four harness ports are env-overridable so independent runs (e.g. parallel
checklist subagents, each in its own worktree against its own Postgres database
via `DATABASE_URL`) don't collide. Unset → the defaults above (CI is unchanged):

| Env var | Default | Purpose |
|---|---|---|
| `PARITY_PY_PORT` | `8765` | FastAPI port |
| `PARITY_TS_PORT` | `3765` | NestJS port |
| `PARITY_PY_DOWN_PORT` | `8766` | FastAPI DB-down pair (DA-18) |
| `PARITY_TS_DOWN_PORT` | `3766` | NestJS DB-down pair (DA-18) |

## What the tests check

- **`test/health-response.parity.test.ts`** — Response parity. `GET /health` on both
  backends: same 200 status, JSON content-type on both, and identical JSON bodies. The
  two live responses are compared **to each other** (not just to a literal), so future
  drift fails.
- **`test/openapi.parity.test.ts`** — OpenAPI **structural** parity. Byte-equality is
  not expected (FastAPI emits 3.1, NestJS 3.0.x, different `$ref` names). Each document
  is normalized (see below) and the `/health` operation is checked for: same path, same
  method, same success status (200), and an equivalent success schema. The generic
  structural-diff loop then asserts both backends match the canonical for every
  **implemented** operation (`IMPLEMENTED_PATHS`); **pending** operations are reported as
  skipped, and a guard asserts the canonical doc declares the complete frozen inventory.
  A **subset guard** (P8.1) asserts FastAPI exposes no path beyond canonical **except** the
  Python-only `/api/v1/ingest/*` carve-out, and that NestJS exposes **none** of the ingest paths.
- **`test/transactions.parity.test.ts`** (P4.1) — value parity for
  `GET /api/v1/transactions`. Seeds a synthetic fixture (`src/db.ts`) into the shared
  Postgres, then asserts both backends return identical paginated bodies (money string,
  dates `YYYY-MM-DD`, absent optionals omitted — DA-6), an identical canonical **422** on a
  bad query (DA-1), an empty `data` + correct `total` for an offset past the end (DA-4),
  and — against a second short-lived backend pair pointed at an unreachable DB — an
  identical canonical **503** (DA-18).
- **`test/budget.parity.test.ts`** (P4.2) — **cross-backend identity** (DA-9) for
  `GET /api/v1/budget`. Seeds a synthetic budget fixture (`seedBudgetFixture` in `src/db.ts`,
  keyed by a unique `window`) into the shared Postgres, then asserts FastAPI and NestJS return
  the **same** parsed body (both thin-read the precomputed aggregate tables — no recompute,
  DA-23): money decimal-string (DA-2), percentages numeric 0–100 (DA-22), dates `YYYY-MM-DD`,
  deterministic ordering (50/30/20 buckets, categories/monthly/recurring sorted). Also covers an
  unknown window → identical zeros + empty arrays, and — against the unreachable-DB backend pair —
  an identical canonical **503** (DA-18).
- **`test/connections.parity.test.ts`** (P6.1) — value + **security** parity for the connections
  API. Both backends boot with `PLAID_FAKE=1` (network-free fake Plaid gateway) and a SYNTHETIC
  shared `APP_ENCRYPTION_KEY`. Covers: identical `link-token`/`exchange` shapes (expiration ISO-`Z`,
  access_token never returned); **no plaintext token at rest** (the `plaid_items.access_token` BYTEA
  has no token substring); **cross-backend decrypt** (DA-12) — a token written by FastAPI decrypts
  with `node:crypto` and a token written by NestJS decrypts with the Python `cryptography.AESGCM`
  (via a `uv run` subprocess); the `{items,sources}` snapshot; forged + unsigned webhook → identical
  canonical **401** (DA-11); a **log-scrub** check (no token string in either backend's captured
  logs, DA-14); and the OAuth **redirect allowlist** rejecting a non-allowlisted URI (no open redirect).
- **`test/endpoints.parity.stubs.test.ts`** — per-endpoint **value-parity stubs**
  (`it.todo`) for every not-yet-implemented view/source endpoint; each names
  the concrete same-request→same-body / error / empty / degraded assertion a Stage-4 `BE`
  branch must fill in.
- **`test/normalize.unit.test.ts`** — pure unit tests for the normalizer.
- **`test/contract.unit.test.ts`** — pure unit tests for the contract loader: the frozen
  path inventory, the implemented/pending partition, and the Appendix A conventions baked
  into the reusable components.
- **`test/backends.unit.test.ts`** — pure unit tests for the health-poll guard
  (including the `{"status":"healthy"}` rogue-process rejection).

## The normalizer (`src/normalize.ts`)

`normalizeApi(doc)` reduces an arbitrary OpenAPI document to a comparable
`{ path: { method: { method, successStatus, successSchema } } }` map. It resolves
`$ref`s, strips OpenAPI version / `$ref` names / titles / examples / descriptions /
key-ordering, and collapses 3.1 nullable unions (`["string","null"]` → `"string"`).
It walks **every** path + method, so new endpoints are auto-covered.

## Canonical contract (`openapi.canonical.json`)

The agreed source-of-truth shape. As of **P2.2 this contract is COMPLETE and FROZEN**
(DA-25): it declares **every** path the program will serve — view
(`/api/v1/{transactions,budget,networth,investments,debt,goals}`), source
(`/api/v1/sources/*`), and connections (`/api/v1/connections/*`) — plus `/health`.
It bakes in the **Appendix A** conventions as reusable components:

- `Money` — 2dp decimal **string** (`"123.45"`), never a JSON number.
- `Percentage` — JSON **number** on a 0–100 scale.
- `Date` / `DateTime` — `YYYY-MM-DD` / ISO-8601 UTC `…Z`.
- `Pagination` — `{ data, pagination{ limit, offset, total } }` (never a top-level array).
- The enum registry — `Bucket`, `Source`, `SourceMode`, `ItemStatus`, `LoanPriority`, `PayoffStrategy`.
- `Error` — the one canonical error envelope `{"error":{code,message,details[]}}` (validation → **422**).

All example values are **synthetic**. Stage-4 endpoint branches **must not edit this file**
(contract-first; each adds only its implementation + flips an allowlist entry).

### The ingestion carve-out (P8.1) — Python-owned, NOT in this contract

Ingestion/extraction is **Python-owned** and intentionally **out of the 1:1 read-parity
contract** — exactly like Alembic owns migrations. The upload/extract/load endpoints
(`POST /api/v1/ingest/{source}`, `source ∈ {transactions, income, holdings, accounts, loans}`)
depend on Python-only libraries (pdfplumber, PyYAML) and live in the **FastAPI backend ONLY**;
NestJS implements none of them. Therefore:

- `/api/v1/ingest/*` is **NOT** declared in `openapi.canonical.json` (the canonical doc still has zero ingest paths — asserted by a unit test).
- The harness **ignores** `/api/v1/ingest/*` when diffing FastAPI's `/openapi.json` against canonical — `isIngestPath()` / `INGEST_PATH_PREFIX` in `src/contract.ts`. A positive **subset guard** keeps this honest: the carve-out is the *only* allowed divergence, so an accidental extra **read** endpoint still fails the gate, and NestJS exposing any ingest path fails too.
- Only the **read** API stays at strict 1:1 parity. See `.claude/rules/backend-parity.md`.

### Lint + mock

```bash
npm run lint:openapi     # redocly lint (config: redocly.yaml) — must be clean
npm run mock             # prism mock openapi.canonical.json (serves example bodies)
```

The Prism mock is what the frontend develops against (DA-21): it serves the contract's
examples, so a `curl` to any path returns an Appendix-A-conformant body without any
backend running.

## Implemented vs pending — `src/contract.ts`

Because the contract is frozen-and-complete but the backends implement it one `BE`
branch at a time, `src/contract.ts` holds an **`IMPLEMENTED_PATHS`** allowlist of the
operations that are LIVE in both backends today (`GET /health`, `GET /api/v1/transactions`
since P4.1, and `GET /api/v1/budget` since P4.2). The structural-diff test scopes its strict cross-backend
assertion to that set; **pending** operations are reported as `skip`/`todo` so the gate
never fails just because the canonical doc lists a not-yet-built route.

`src/db.ts` seeds/cleans a small **synthetic** fixture for value-parity tests that need a
known DB state; `src/backends.ts#startDbDownBackends` boots a second pair against an
unreachable DB so a degraded-state (503) parity case can be asserted (DA-18).

## Adding a new endpoint's parity test (Stage-4 `BE` branch)

When an endpoint is implemented in **both** backends (same branch, per Rule #1):

1. **Do NOT touch `openapi.canonical.json`** — the operation is already declared there.
2. Add its `"<METHOD> <path>"` key to **`IMPLEMENTED_PATHS`** in `src/contract.ts`. The
   generic structural-diff test in `test/openapi.parity.test.ts` then asserts both
   backends match the canonical op (and each other) — auto-covered, no per-endpoint code.
3. Fill in the matching **value-parity** stub in `test/endpoints.parity.stubs.test.ts`
   (replace `it.todo(...)` with a real `it(...)`): hit the same path on both
   `inject('pyBase')` and `inject('tsBase')` (use `getJson` from `src/http.ts`), assert
   the two bodies equal each other AND satisfy Appendix A (money string, percentage
   number, datetime `…Z`, pagination envelope, omit-absent), plus the error/empty/degraded
   cases the checklist Verify names.
4. Run `npm run test:parity`. Both backends boot and the new operation is checked.

No real financial data anywhere — synthetic only.
