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
- **`test/endpoints.parity.stubs.test.ts`** — per-endpoint **value-parity stubs**
  (`it.todo`) for every not-yet-implemented view/source/connections endpoint; each names
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
operations that are LIVE in both backends today (only `GET /health` at P2.2). The
structural-diff test scopes its strict cross-backend assertion to that set; **pending**
operations are reported as `skip`/`todo` so the gate never fails just because the
canonical doc lists a not-yet-built route.

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
