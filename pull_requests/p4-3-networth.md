# P4.3 — `GET /api/v1/networth` (Net Worth view, both backends at parity)

## Summary

Adds the **Net Worth** view endpoint in **both** backends at strict 1:1 parity: a
**thin read** of the `accounts` table composed into the design §3 shape — **no
recompute** in either backend (DA-23). For the same DB state FastAPI and NestJS
return byte-identical bodies (DA-9). Implements against the frozen canonical
OpenAPI (DA-25) — no contract edits.

**Composition (deterministic, from `accounts.balance` only):** `assets` = sum of
positive balances; `liabilities` = abs of negative balances (signed-balance
convention); `net_worth` = their net. `accounts[]` is sorted by name (then id),
each with `delta_30d` `"0.00"` and `series` **empty** — the snapshot `accounts`
table holds no balance history, so neither is fabricated (a clock-derived value
would break cross-backend parity). A null balance counts as 0; empty DB → zero
totals + empty arrays; DB unavailable → canonical 503.

## Changes (Large tier — by realm)

- **backend-python/** — `app/routers/networth.py` (FastAPI router + `build_networth`),
  `NetWorth`/`NetWorthAccount`/`NetWorthSeriesPoint` Pydantic models in `app/schemas.py`
  (money decimal-string), router registered in `app/main.py`; reuses `app/errors.py`
  (422/503). Tests: `tests/test_networth.py`.
- **backend-ts/** — `src/networth/` (controller + query DTO + response DTOs + service
  reading the `accounts` repo) wired into `app.module.ts`; reuses the canonical
  exception filter. Totals are summed in **integer cents** (never a float) so the
  decimal strings are byte-identical to FastAPI's `Decimal`. Unit specs + e2e
  (`test/networth.e2e-spec.ts`); the existing health/budget/transactions e2e + the
  AppModule compile spec gained the new `AccountEntity` repo override.
- **contracts/** — `IMPLEMENTED_PATHS` now includes `GET /api/v1/networth` (`src/contract.ts`);
  `seedNetworthFixture`/`cleanupNetworthFixture` in `src/db.ts`; the parity test
  `test/networth.parity.test.ts`; `contract.unit.test.ts` updated. Structural OpenAPI
  diff is clean.
- **docs** — `backend-python/README.md`, `backend-ts/README.md`, `docs/STRUCTURE.md`
  (CHANGELOG + tree); P4.3 marked `[x]` in `plans/agent_checklist.md`.

## Feature mapping

Serves the **Net Worth** screen (design §3): net-worth totals, per-account
balances + 30-day deltas, monthly series. Phase-1 reads the local-CSV-fed
`accounts` snapshot; the Plaid-fed history that populates `series`/`delta_30d` is
a later adapter swap behind the same endpoint.

## Happy-path verification

Seeded synthetic accounts in an isolated DB, then hit **both** backends — the
responses are byte-identical (assets `178900.00`, liabilities `26560.00`,
net_worth `152340.00`; null balance → `"0.00"`; `series` empty):

![P4.3 identical networth response (FastAPI + NestJS)](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/5295994f544f1e1deaec009a0407323c96e42a02/pull_requests/evidence/p4-3-networth/proof.png)

## Test plan (gate results)

- **Python** (`ruff check` + `ruff format --check` + `pytest --cov`): green —
  **98.84%** coverage (the single deselected `test_config::test_default_settings`
  is only an artifact of the isolated `DATABASE_URL` export; it passes in CI).
- **TypeScript** (`lint` + `format:check` + `test:cov`): green — 20 suites / 129
  tests; overall **92.79%** coverage.
- **Parity** (`contracts/` `npm run test:parity`): green — networth identity /
  empty-DB zeros / DB-down 503 all pass; structural OpenAPI diff clean;
  `redocly lint` clean.

## Checklist

- [x] Endpoint implemented in both backends at 1:1 parity (route/schema/status/error)
- [x] `contracts/` parity test + `IMPLEMENTED_PATHS` updated; OpenAPI diff clean
- [x] No edits to the frozen canonical OpenAPI (DA-25)
- [x] Money decimal-string; empty-DB zeros/empty arrays; canonical 422/503
- [x] All three gates ≥ 80% coverage; synthetic data only (no real financials)
- [x] READMEs + `docs/STRUCTURE.md` updated; P4.3 marked done
