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
  method, same success status (200), and an equivalent success schema (object with a
  required string `status`). Both backends are also asserted to conform to the canonical
  contract.
- **`test/normalize.unit.test.ts`** — pure unit tests for the normalizer.
- **`test/backends.unit.test.ts`** — pure unit tests for the health-poll guard
  (including the `{"status":"healthy"}` rogue-process rejection).

## The normalizer (`src/normalize.ts`)

`normalizeApi(doc)` reduces an arbitrary OpenAPI document to a comparable
`{ path: { method: { method, successStatus, successSchema } } }` map. It resolves
`$ref`s, strips OpenAPI version / `$ref` names / titles / examples / descriptions /
key-ordering, and collapses 3.1 nullable unions (`["string","null"]` → `"string"`).
It walks **every** path + method, so new endpoints are auto-covered.

## Canonical contract (`openapi.canonical.json`)

The agreed source-of-truth shape. The parity test asserts **both** backends conform to
it structurally. Keep it minimal; it grows one operation at a time.

## Adding a new endpoint's parity test

When an endpoint is added to **both** backends (same branch, per Rule #1):

1. **Add the operation to `openapi.canonical.json`** — path, method, success status,
   and the success-response JSON schema (object/array, `required`, property types).
2. **Response parity:** the structural OpenAPI test already loops over every canonical
   operation and asserts both backends match — so it is auto-covered. For
   behavior/value parity (specific request → specific body), add a small test in
   `test/` that hits the same path on both `inject('pyBase')` and `inject('tsBase')`
   and compares the responses to each other (use `getJson` from `src/http.ts`).
3. Run `npm run test:parity`. Both backends boot, and the new operation is checked
   structurally on both plus against the canonical contract.

No real financial data anywhere — synthetic only.
