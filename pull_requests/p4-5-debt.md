# P4.5 — `GET /api/v1/debt` (Debt view, both backends at parity)

## Summary

Implements the **Debt screen** view endpoint in **both** backends at strict 1:1 parity (Rule #1).
`GET /api/v1/debt` is a thin read of the `loans` table that composes the design §3 Debt shape:
`total`, balance-weighted `weighted_avg_rate`, `monthly_minimum`, rate `tranches[]`, the underlying
`loans[]`, and **both** `payoff[]` projections — **avalanche** (highest-rate-first acceleration) and
**minimums** (pay only the minimums). The payoff projections come from a deterministic **integer-cent
month-by-month amortization** implemented identically in Python (`project_payoff`) and TypeScript
(`projectPayoff`) — same accrual order, same half-up rounding, same horizon cap — so `debt_free_year`
and `total_interest` match **to the cent** across backends (DA-9).

## Changes (Large — > 10 files; by realm)

- **backend-python/** — `app/routers/debt.py` (router + payoff sim + tranche/weighted-rate helpers);
  `Debt`/`DebtTranche`/`PayoffProjection`/`LoanOut` + `LoanPriority`/`PayoffStrategy` enums in
  `app/schemas.py`; router wired in `app/main.py`; `tests/test_debt.py` (success / both strategies /
  strategy-422 / empty-DB zeros / DB-down 503 + payoff unit tests).
- **backend-ts/** — `src/debt/` module (`debt.controller.ts`, `debt.service.ts` with the integer-cent
  `projectPayoff` twin + helpers, `debt-query.dto.ts` with `@IsIn` strategy validation,
  `debt-response.dto.ts`); registered in `src/app.module.ts`; `*.spec.ts` units + `test/debt.e2e-spec.ts`.
  The new `LoanEntity` repository is registered in `AppModule`, so the existing e2e/module specs
  (`health`, `transactions`, `budget`, `app.module`) gained a `LoanEntity` override.
- **contracts/** — `test/debt.parity.test.ts` (cross-backend identity / avalanche-vs-minimums /
  strategy-422 / DB-down 503); `seedDebtFixture`/`cleanupDebtFixture` + `SEED_LOANS` in `src/db.ts`;
  `/api/v1/debt` added to `IMPLEMENTED_PATHS` (`src/contract.ts`) so the structural OpenAPI diff covers
  it; `contract.unit.test.ts` inventory + `endpoints.parity.stubs.test.ts` updated.
- **docs** — `backend-python/README.md`, `backend-ts/README.md`, `docs/STRUCTURE.md`, and P4.5 marked
  `[x]` in `plans/agent_checklist.md`. The canonical `openapi.canonical.json` is **unchanged** (frozen, DA-25).

## Feature mapping

Serves the **Debt screen** (design §3): debt total, weighted-average rate, payoff comparison
(avalanche vs minimums), rate tranches, and the per-loan breakdown.

## Happy-path verification

Both backends booted against the seeded synthetic `loans` and queried — **byte-identical** JSON
(diff clean). Avalanche (`6533.59` interest) beats minimums (`6558.87`); enums and money/rate
conventions per Appendix A. Synthetic data only (data-privacy.md).

![P4.5 identical debt response](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/7af642c8cdaa986c7b5cb1d6699c33f281c9859c/pull_requests/evidence/p4-5-debt/proof.png)

## Test plan (gate results)

- **Python** (`backend-python/`): ruff clean; **150 tests, 99% cov** (the one local `test_config`
  failure is the mandatory `pf_p45` `DATABASE_URL` isolation override — it passes in CI where the URL
  is the default).
- **TypeScript** (`backend-ts/`): lint + format clean; **134 tests, 93.6% statements / 86% branches**.
- **Parity** (`contracts/`): `npm run test:parity` **58 passed**; OpenAPI structural diff clean (debt
  path in `IMPLEMENTED_PATHS`).

## Checklist

- [x] Endpoint in both backends, same branch (`BE`).
- [x] Identical route / response / status / error body; enums per the shared registry.
- [x] `contracts/` parity test added; avalanche **and** minimums both covered; DB-down 503 identical.
- [x] Money decimal-string, rates numeric 0–100, dates `YYYY-MM-DD`, omit-absent.
- [x] READMEs + `docs/STRUCTURE.md` updated; canonical OpenAPI untouched (DA-25).
- [x] Committed Playwright/terminal evidence screenshot.
