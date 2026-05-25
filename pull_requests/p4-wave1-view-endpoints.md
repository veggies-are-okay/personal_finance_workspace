# P4.3–P4.6 — Wave-1 view endpoints (integration)

## Summary

Integrates the four **Wave-1 read endpoints** that were built in parallel on
separate branches into one branch:

- `GET /api/v1/networth` (P4.3) — Net Worth screen
- `GET /api/v1/investments` (P4.4) — Investments screen
- `GET /api/v1/debt` (P4.5) — Debt screen
- `GET /api/v1/goals` (P4.6) — Goals / Home screen

Each is a **thin read** of the P2.3 tables (`accounts` / `holdings` / `loans` /
`goals`) in **both** backends at strict 1:1 parity — **no recompute** in either
backend (DA-23). Money is a decimal **string**, percentages are JSON **numbers**
0–100 (DA-22), absent optionals omitted (DA-6); empty DB → well-formed
zeros/empty arrays; DB-down → canonical **503** (DA-18).

The four branches all touched the same shared scaffolding, so this integration
**unions** their additive contributions — no endpoint dropped.

## Changes (by realm)

- **backend-python (FastAPI):** four new routers (`app/routers/{networth,investments,debt,goals}.py`)
  registered in `app/main.py`; their Pydantic response models added to
  `app/schemas.py` (NetWorth*, Investments/Allocation/Concentration/Holding,
  Debt/DebtTranche/PayoffProjection/LoanOut + LoanPriority/PayoffStrategy enums,
  Goals/GoalFunding/Affordability).
- **backend-ts (NestJS):** four new feature modules (`src/{networth,investments,debt,goals}/`)
  added to `AppModule.imports`. Integration fix: each endpoint's own
  `*.e2e-spec.ts` now overrides **all** view-entity repos (Account/Holding/Loan/Goal)
  so the merged `AppModule` still boots DB-less.
- **contracts (parity):** `IMPLEMENTED_PATHS` gains all four op keys; `src/db.ts`
  gains all four `seed*/cleanup*Fixture` helpers; four `test/*.parity.test.ts`
  suites; `contract.unit.test.ts` / `endpoints.parity.stubs.test.ts` path lists
  unioned. `openapi.canonical.json` untouched (frozen — DA-25).
- **docs:** `backend-python/README.md`, `backend-ts/README.md`, `docs/STRUCTURE.md`
  endpoint sections unioned; `plans/agent_checklist.md` marks P4.3–P4.6 done.

## Feature mapping

networth → Net Worth screen · investments → Investments screen · debt → Debt
screen · goals → Goals/Home screen. Together they back the read side of the
Wave-1 frontend (P5.1) against live backends.

## Happy-path verification

Both backends seeded with **synthetic** fixtures and run on the dedicated ports
(FastAPI :8765, NestJS :3765, shared Postgres); all four endpoints curled from
each and compared at the contract value level — **byte/value-identical** (DA-9):

![Four view endpoints identical across both backends](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/753021c6129fe31e3ca53d7d22633ada6fa329f7/pull_requests/evidence/p4-wave1-view-endpoints/proof.png)

Each branch's own proof is also under `pull_requests/evidence/p4-3-networth/`,
`p4-4-investments/`, `p4-5-debt/`, `p4-6-goals/`.

## Test plan (all gates green, local default setup)

- **Python** (`backend-python/`): ruff + format clean; **176 passed, 98.81%** cov.
- **TS** (`backend-ts/`): lint + format clean; **208 passed (29 suites), 90.85%** cov.
- **Parity** (`contracts/`): **67 passed** incl. all four new endpoint suites;
  structural OpenAPI diff clean.

## Checklist

- [x] Endpoints in **both** backends at 1:1 parity (no drift)
- [x] `contracts/` parity tests + clean OpenAPI structural diff
- [x] Money decimal-string, percentages numeric 0–100, omit-absent (Appendix A)
- [x] All three gates green; happy-path screenshot committed (synthetic only)
- [x] READMEs + `docs/STRUCTURE.md` + checklist updated
