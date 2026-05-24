# P2.2 — Canonical API contract & mock

## Summary

Authors the **complete, frozen** canonical OpenAPI contract and the tooling that keeps
it honest. Per the contract-first model (design §8) and DA-25, every path the program
will serve is declared **up front** so Stage-4 endpoint branches implement against it and
never edit the contract file. **Contracts-only** — no backend routes change; the contract
is the parity source of truth both backends will be checked against.

Branch: `2026-05-24-BE/api-contract-mock` (type BE — contracts only).

## Changes

- **`contracts/openapi.canonical.json`** — extended from the `/health`-only stub to the
  full **16-operation** inventory: view (`/transactions` paginated, `/budget`,
  `/networth`, `/investments`, `/debt`, `/goals`), source (`/sources/*` ×5), connections
  (`/connections/{link-token,exchange}`, `GET /connections`, `webhook`) + `/health`.
  Schemas follow design §3. **Synthetic examples only.**
  - **Appendix A as reusable components:** `Error` envelope (`{"error":{code,message,
    details[]}}`, validation → **422**); `Money` = 2dp decimal **string**; `Percentage` =
    **number** 0–100; `Date`/`DateTime` (`YYYY-MM-DD` / ISO-8601 UTC `…Z`); `Pagination`
    `{data,pagination{limit,offset,total}}`; the enum registry (`Bucket`, `Source`,
    `SourceMode`, `ItemStatus`, `LoanPriority`, `PayoffStrategy`); optional fields omitted
    (not null). Source responses carry `source_status` for `not_connected` (DA-20).
- **Lint** — `@redocly/cli` dev-dep + `redocly.yaml` + `lint:openapi` script. Clean.
- **Mock** — `@stoplight/prism-cli` dev-dep + `mock` script (`prism mock
  openapi.canonical.json`); serves the contract examples for FE dev (DA-21).
- **Parity harness extension** — `src/contract.ts` (canonical loader +
  **`IMPLEMENTED_PATHS`** allowlist; only `GET /health` live now). `openapi.parity.test.ts`
  structural diff scoped to implemented paths + a frozen-inventory guard; pending ops
  surface as skipped. `endpoints.parity.stubs.test.ts` per-endpoint value-parity stubs
  (`it.todo`). `contract.unit.test.ts` unit tests for inventory/partition/Appendix A.
- **Docs** — `contracts/README.md`, `docs/STRUCTURE.md` updated.

## Test plan

- **Spec lint:** `npm run lint:openapi` → *"Your API description is valid. 🎉"* (0 errors,
  0 warnings).
- **Mock smoke:** `npm run mock` boots; `curl` confirms Appendix A on served bodies:
  - `/api/v1/transactions` → `data` array + `pagination{limit,offset,total}`; `amount` is
    a **string** (`"-4.75"`).
  - `/api/v1/budget` → `savings_rate` / `target_pct` are **numbers** (`22`, `50`);
    `amount` is a **string** (`"2400.00"`).
  - `/api/v1/sources/transactions` → `{source,mode,source_status,data}` envelope.
  - `Prefer: code=422` on `/api/v1/transactions` → canonical `error.code=VALIDATION_ERROR`
    + `details[]`.
  - `POST /api/v1/connections/webhook` → `{status:"accepted"}`.
- **Parity gate (`npm run test:parity`, boots both backends):** GREEN — **30 passed,
  15 skipped (pending endpoints), 18 todo (stubs), 0 failed.** Existing `/health`
  response + structural parity intact; no backend impl added for new paths.
- **Typecheck / format:** `npm run lint` (tsc) clean; `npm run format:check` clean.

## Checklist

- [x] Canonical OpenAPI complete for all view/source/connections paths + `/health` (frozen, DA-25).
- [x] Appendix A conventions as reusable components (Error/Money/Percentage/Date(Time)/Pagination/enums/null-omission).
- [x] `redocly lint` passes clean (config + npm script).
- [x] Prism `mock` script boots and serves Appendix-A-conformant example bodies.
- [x] Per-endpoint parity stubs + structural-diff scaffold; existing `/health` parity stays green.
- [x] Synthetic data only; no real financial values anywhere.
- [x] `plans/agent_checklist.md` P2.2 marked `[x]`; README + STRUCTURE updated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
