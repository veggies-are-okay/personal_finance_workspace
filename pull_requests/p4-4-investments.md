# P4.4 — `GET /api/v1/investments` (Investments view), both backends at parity

## Summary

Adds the **Investments view** endpoint in **both** backends at strict 1:1 parity (Rule #1), plus a `contracts/` cross-backend parity test. It is a **thin read** of the `holdings` table — **no analytics are recomputed in either backend** (DA-23): portfolio totals and the allocation/concentration percentages are simple, deterministic aggregations applied identically in FastAPI and NestJS, so for the same DB state both return the same JSON (DA-9). The canonical `openapi.canonical.json` is untouched (frozen, DA-25); only `IMPLEMENTED_PATHS` flips the path on.

Response (design §3): `portfolio_value`, `unrealized_gain`, `allocation[{class,target_pct,actual_pct,amount}]`, `concentration[{holding,weight}]`, `holdings[{symbol,name,value,weight,gain}]`.

## Changes (Large tier — by realm)

- **backend-python/** — `app/routers/investments.py` (the thin read + aggregation, reusing `app/errors.py` for the canonical 503) registered in `app/main.py`; `Investments`/`Allocation`/`Concentration`/`Holding` Pydantic models in `app/schemas.py` (money decimal-string, percentages numeric 0–100, `class` aliased from the reserved-word-safe `class_`). Tests in `tests/test_investments.py`.
- **backend-ts/** — `src/investments/` (controller + service reading the `holdings` repo + response DTOs) wired into `app.module.ts`. Money is summed in integer **cents** so totals are byte-identical to FastAPI's `Decimal` sum; reuses `formatMoney`/`formatPercent`. Unit + controller specs + `test/investments.e2e-spec.ts`. The existing health/budget/transactions e2e + `app.module.spec.ts` now also override the `HoldingEntity` repo (the new `forFeature` provider) so the DB-down boot still works.
- **contracts/** — `test/investments.parity.test.ts` (cross-backend identity DA-9 / empty-DB / DB-down 503); `seedInvestmentsFixture`/`cleanupInvestmentsFixture` in `src/db.ts`; `IMPLEMENTED_PATHS` adds the path (`contract.ts`) so the structural OpenAPI diff covers it; `contract.unit.test.ts` inventory updated.
- **docs/** — `backend-python/README.md`, `backend-ts/README.md`, `docs/STRUCTURE.md` updated; P4.4 marked `[x]` in `plans/agent_checklist.md`.

## Feature mapping

Serves the **Investments screen** (one of the 7 view screens). The frontend (P5.1) renders portfolio value, target-vs-actual allocation, concentration risk, and the holdings table from this single endpoint.

### Derivation (deterministic, no recompute)

- `portfolio_value` = Σ holding `value`; `unrealized_gain` = Σ holding `gain`.
- `allocation[]` grouped by `asset_class`: `amount` = Σ value; `actual_pct` = group market share of the portfolio; `target_pct` = Σ of the group's stored per-holding `weight` (intended allocation). NULL `asset_class` → `unclassified`. Ordered by class name.
- `concentration[]` = each holding's market-value share, ranked descending then by symbol.
- `holdings[]` = rows ordered by symbol; `weight` is the stored per-holding weight.
- Empty DB → `"0.00"` totals + empty arrays. Zero-value portfolio is guarded (no division by zero). DB unavailable → canonical **503** (DA-18).

## Happy-path verification

Both backends booted against the isolated DB (`pf_p44`) with a synthetic holdings fixture; the SAME `GET /api/v1/investments` request returns the SAME JSON from FastAPI (:8744) and NestJS (:3744). Money is a decimal string (`"50000.00"`), allocation/concentration/holding percentages are JSON numbers 0–100 (`90.0`/`90`), holdings ordered by symbol, concentration ranked by descending share — proving neither backend recomputes and the wire conventions match.

![P4.4 identical investments response (FastAPI + NestJS)](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/b6e5aa3c39086e4e8ba0ad2d6096a5b083729df2/pull_requests/evidence/p4-4-investments/proof.png)

## Test plan (gate results)

- **Python** (`backend-python/`): ruff + format clean; pytest **143 passed / 99% cov** (1 pre-existing config test deselected locally — it asserts `DATABASE_URL` equals the literal CI default and passes in CI where that env matches; unrelated to this change). `investments.py` 100%.
- **TS** (`backend-ts/`): lint + format:check clean; jest **123 passed / 87.6% global cov** (≥80 gate).
- **Parity** (`contracts/`): `npm run test:parity` **57 passed**; OpenAPI structural diff clean for the new path.
- **Frontend:** untouched.

## Checklist

- [x] Endpoint in both backends, identical route/response/status/error shape
- [x] `contracts/` parity test (success / empty / DB-down 503) + `IMPLEMENTED_PATHS` updated; OpenAPI diff clean
- [x] Money decimal-string, percentages numeric 0–100 (Appendix A)
- [x] No recompute — thin read of `holdings` (DA-23); synthetic fixtures only (data-privacy)
- [x] READMEs + `docs/STRUCTURE.md` + checklist updated; evidence screenshot embedded
