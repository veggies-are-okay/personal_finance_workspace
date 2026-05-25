# P4.2 — `GET /api/v1/budget` (Budget view, both backends)

## Summary

Implements the **Budget view** endpoint in **both** backends at strict 1:1 parity.
Per the connectors design (§5) and **DA-23**, both backends are **thin reads** of the
precomputed aggregate tables written by the P3.2 ingestion pipeline — **no
categorization/recompute logic in either backend**. The response covers every `/budget`
field in design §3: 50/30/20 buckets, `savings_rate` + `effective_tax_rate`, category
breakdown, monthly needs/wants, and recurring charges.

Wire conventions (Appendix A): **money = decimal string** (DA-2), **percentages = JSON
number 0–100** (DA-22), **dates = `YYYY-MM-DD`** (DA-3). A `window` selector (default
`12m`) scopes the aggregate rows; an empty DB returns well-formed zeros + empty arrays;
a DB failure returns the canonical **503** (DA-18).

## Changes (Large — by realm)

- **backend-python/ (FastAPI):** `app/routers/budget.py` composes `budget_aggregates` +
  `budget_{bucket,category,monthly}_aggregates` + `recurring_charges` into the response;
  new `Budget`/`BudgetBucket`/`BudgetCategory`/`MonthlyNeedsWants`/`RecurringChargeOut`
  Pydantic models in `app/schemas.py` (money via `field_serializer` → string, percentages
  → float). Reuses `app/errors.py` (422/503). Registered in `app/main.py`.
- **backend-ts/ (NestJS):** `src/budget/` module — controller + `BudgetQueryDto` +
  service reading the SAME 5 aggregate repositories via TypeORM; `formatPercent` numeric
  helper, reuses `formatMoney`/`formatDate` from the transactions service; canonical
  exception filter inherited. Wired into `app.module.ts`.
- **contracts/:** `test/budget.parity.test.ts` (cross-backend identity DA-9, unknown-window
  empty, DB-down 503) + `seedBudgetFixture`/`cleanupBudgetFixture` in `src/db.ts`; `budget`
  added to `IMPLEMENTED_PATHS` so the generic structural OpenAPI diff now asserts it.
- **Docs:** `backend-python/README.md`, `backend-ts/README.md`, `contracts/README.md`,
  `docs/STRUCTURE.md`, and `plans/agent_checklist.md` (P4.2 → `[x]`).

## Feature mapping

Serves the **Budget screen** and its **50/30/20** breakdown (design §3). Consumes the
P3.2 precompute output; keeps parity trivial by never reimplementing categorization in TS.

## Happy-path verification (parity endpoint → BOTH backends)

Seeded a synthetic budget fixture (`window=parity-p42`; no real data), booted both
backends, and curled `/api/v1/budget` from each. The parsed JSON is **identical** across
FastAPI and NestJS (the parity-harness comparison). Money is a decimal string, percentages
numbers, dates `YYYY-MM-DD`.

![P4.2 identical budget response (FastAPI + NestJS)](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/9e9a7f422ac36471818d311ec17904e50ebf0b9a/pull_requests/evidence/p4-2-budget/proof.png)

## Test plan (gate results)

- **Python** (`backend-python/`): `ruff check` + `ruff format --check` clean; `pytest --cov=app` →
  **135 passed, 99% coverage** (≥80).
- **TS** (`backend-ts/`): `lint` + `format:check` clean; `test:cov` → **100 passed, 90.6%
  global coverage** (≥80).
- **Parity** (`contracts/`): `npm run test:parity` → **54 passed**, 13 todo, 13 skipped;
  structural OpenAPI diff clean (budget now in `IMPLEMENTED_PATHS`). Cross-backend identity
  (DA-9) and DB-down 503 (DA-18) both green.
- **Frontend:** untouched.

## Checklist

- [x] Endpoint in both backends, identical route/response/status/error body
- [x] No recompute in either backend — thin reads of precomputed tables (DA-23)
- [x] Money decimal-string, percentages numeric 0–100, dates `YYYY-MM-DD`
- [x] `contracts/` parity test incl. cross-backend identity (DA-9) + DB-down 503 (DA-18)
- [x] Canonical OpenAPI unedited (DA-25); `IMPLEMENTED_PATHS` toggled; diff clean
- [x] All three gates green; READMEs + `docs/STRUCTURE.md` + checklist updated
- [x] Synthetic fixtures only; no real financial data
