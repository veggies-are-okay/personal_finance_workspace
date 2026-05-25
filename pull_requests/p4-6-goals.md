# P4.6 — `GET /api/v1/goals` (Goals view), both backends at parity

## Summary

Adds the **Goals view** endpoint in **both** backends at strict 1:1 parity plus a
`contracts/` parity test. It is a **thin read** of the `goals` table composed into the frozen canonical
`Goals` shape — **no recompute** (DA-23). Both backends read the SAME table, so
FastAPI and NestJS return deep-equal bodies (DA-9). Reuses P4.1's canonical handlers.

Composition (deterministic, from the `goals` rows only):
- `target` / `saved` = sums across goals (money decimal **string**, DA-2);
- `progress_pct` = overall ratio `saved/target*100` (JSON **number** 0–100, DA-22; `0` when target is 0);
- `funding[]` = one `{source,amount}` per goal, **sorted by name** (then id);
- `affordability{}` = a fixed **zero-filled** block — the P2.3 schema has no
  affordability table, so neither backend fabricates data.

Empty DB → `target`/`saved` `"0.00"`, `progress_pct` `0`, empty `funding`, zero
`affordability`. DB unreachable → canonical **503** (DA-18).

## Changes (Medium tier — grouped by module)

- **backend-python/** — `app/routers/goals.py` (`GET /api/v1/goals`, thin read +
  503 mapping), `Goals`/`GoalFunding`/`Affordability` Pydantic models in
  `app/schemas.py` (money decimal-string + numeric-percent serializers), router
  registered in `app/main.py`. Tests: `tests/test_goals.py`.
- **backend-ts/** — `src/goals/` (controller + service + DTO + module) wired into
  `app.module.ts`. Service sums in **integer cents** (`toCents`/`centsToString`) so
  totals are exact (never a float); reuses `formatMoney` + the canonical 503.
  Tests: service/controller specs + `test/goals.e2e-spec.ts`; existing e2e/spec
  fixtures gained a `GoalEntity` repo override so AppModule still boots DB-less.
- **contracts/** — `test/goals.parity.test.ts` (cross-backend identity DA-9 /
  empty-DB / DB-down 503), `seedGoalsFixture`/`cleanupGoalsFixture` in `src/db.ts`,
  `/api/v1/goals` added to `IMPLEMENTED_PATHS`; `openapi.canonical.json`
  **unchanged** (DA-25), structural diff clean.
- **docs** — `backend-python/README.md`, `backend-ts/README.md`,
  `docs/STRUCTURE.md`, and `plans/agent_checklist.md` (P4.6 marked `[x]`).

## Feature mapping

Serves the **Goals** screen (design §3): aggregate target/saved + progress, the
per-goal funding breakdown, and the affordability block placeholder.

## Happy-path verification

Both backends booted against an isolated DB seeded with synthetic goals
(target 60000 / saved 21000 → progress 35.0). `GET /api/v1/goals` returns
deep-equal bodies — money decimal-strings, numeric `progress_pct`, funding sorted
by name, zero affordability (JSON-number equality `35.0 == 35`, as P4.1/P4.2 use).

![P4.6 identical goals response from FastAPI + NestJS](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/1322264b110ed8a56703380cf4d45c15d0b3464d/pull_requests/evidence/p4-6-goals/proof.png)

## Test plan (gate results)

- **Python:** `ruff` lint+format clean; suite **99%** branch cov (≥80).
  `test_goals.py` = 7 tests (shape / money strings / numeric progress / funding
  ordering / zero affordability / empty-DB zeros / 503). *(`test_config` asserts
  the default `DATABASE_URL` — green in CI and standalone; the only local miss is
  the parallel-isolation `pf_p46` env var.)*
- **TypeScript:** `lint` + `format:check` clean; **122 tests / 19 suites** pass,
  **88.5%** coverage (≥80); `goals.service.ts` 100%.
- **Parity:** `npm run test:parity` **green** — `goals.parity.test.ts` (3) +
  structural OpenAPI diff clean. 57 tests passed total.

## Checklist

- [x] Endpoint in both backends, identical route/response/status/error shape
- [x] `contracts/` parity test (success + empty + DB-down 503), OpenAPI diff clean
- [x] Money decimal-string, percentages numeric 0–100, no recompute (DA-2/22/23)
- [x] Canonical 503 on DB-unavailable (DA-18), reusing existing handlers
- [x] READMEs + `docs/STRUCTURE.md` + checklist updated; synthetic data only
