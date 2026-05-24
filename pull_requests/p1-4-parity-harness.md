# P1.4 — Cross-backend parity harness (`contracts/`)

**Branch:** `2026-05-24-INFRA/p1-4-parity-harness` · **Base:** `main` · **Date:** 2026-05-24
**Type:** INFRA (test harness only — neither backend's API is changed)

## Summary

Builds the `contracts/` parity harness that **enforces Rule #1**
(`.claude/rules/backend-parity.md`): FastAPI and NestJS must be identical.
`npm run test:parity` is the canonical, self-contained gate — it boots BOTH backends
on dedicated free ports, asserts they agree, and tears them down.

## Changes

- **`contracts/` (new Node + TypeScript + Vitest project).**
  - **`package.json`** — `type: module`; script **`test:parity`** (canonical gate).
    `pretest:parity` → `build:backends` (`uv sync`; `npm install && npm run build`).
    Also `test:unit`, `typecheck`/`lint` (`tsc --noEmit`), `format:check`.
  - **`src/backends.ts`** — spawns FastAPI (`uv run uvicorn app.main:app --port 8765`)
    and NestJS (`node dist/main.js`, `TS_API_PORT=3765`) in their own process groups;
    `waitForHealthy` polls `/health` (bounded) and **fails loudly** on
    `{"status":"healthy"}` (the unrelated :8000 process) or any non-`ok` body;
    `killTree` SIGKILLs each group.
  - **`src/global-setup.ts`** — Vitest `globalSetup`: boots both, `provide`s base URLs,
    returns a teardown that kills both trees even on failure.
  - **`src/normalize.ts`** — reusable OpenAPI structural normalizer: resolves `$ref`s,
    strips version / `$ref` names / titles / examples / ordering, collapses 3.1
    `["string","null"]`, walks every path+method so new endpoints are auto-covered.
  - **`src/http.ts`** — `fetch`-based response capture (status, content-type, JSON).
  - **`openapi.canonical.json`** — minimal canonical contract for `/health`; grows one
    operation at a time.
  - **`test/`** — `health-response.parity`, `openapi.parity` (structural, loops all
    canonical ops), `normalize.unit`, `backends.unit` (rogue-`healthy` rejection).
  - **`vitest.config.ts`** + **`vitest.unit.config.ts`** (units, no boot),
    **`tsconfig.json`**, **`README.md`**, **`.gitignore`**, **`package-lock.json`**.
- **`plans/agent_checklist.md`** — P1.4 marked `- [x]`.
- **`docs/STRUCTURE.md`** — `contracts/` subtree + dated CHANGELOG + Status update.

## Test plan

From `contracts/`:

```
$ npx tsc --noEmit          # typecheck clean
$ npm run test:parity
  pretest: uv sync + npm build      # both backends built
  globalSetup spawns FastAPI :8765 + NestJS :3765, polls /health for {"status":"ok"}
  ✓ health-response.parity (1)   # 200, JSON content-type, bodies equal each other
  ✓ openapi.parity         (4)   # /health structural parity + canonical conformance
  ✓ normalize.unit         (11)
  ✓ backends.unit          (4)   # {"status":"healthy"} rejected; bounded timeout
  Test Files  4 passed | Tests  20 passed ; teardown: both process trees killed
```

Verified after the run: ports 8765 / 3765 free (clean teardown), no stray processes.
Both backends booted, **response parity passes**, and the **structural OpenAPI diff
for `/health` is clean** (FastAPI 3.1 vs NestJS 3.0.x reconciled by the normalizer).
All synthetic; no real data/secrets; `node_modules`/`coverage`/`dist` uncommitted.
Neither backend's API changed, so the Python/TS gates were not re-run.

## Checklist

- [x] `contracts/` Node+Vitest project; `test:parity` is the canonical gate
- [x] Self-contained: boots both backends (:8765 / :3765), polls `/health` for `{"status":"ok"}`, guards against the :8000 `{"status":"healthy"}` process, tears down both trees on success and failure
- [x] Response parity (`/health`: 200, JSON content-type, bodies compared to each other)
- [x] Structural OpenAPI parity for `/health` via a reusable normalizer; both backends checked against `openapi.canonical.json`; new endpoints auto-covered
- [x] Checklist + STRUCTURE.md updated; PR doc added; no secrets/real data; `node_modules`/`dist`/`coverage` gitignored
