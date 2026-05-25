# P3.1 — Load normalized ledger into Postgres (idempotent)

## Summary

Adds an **idempotent loader** that writes the normalized signed-amount ledger
into the `transactions` table. Re-importing the same ledger **upserts** on a
deterministic dedupe key (DA-19) — no duplicate rows, stable counts. The
DB-writing loader lives in `backend-python/app/ingestion/` (under the
`python-backend` CI gate, reusing `app.models` + `app.db`); the raw→normalized-CSV
normalizers stay in `scripts/`. **BE-PY only** — no new HTTP endpoint, so the
FastAPI OpenAPI surface (`/health`) and backend parity are unchanged.

## Changes (Medium tier — 7 files, grouped by module)

- **`backend-python/app/ingestion/`** (new module)
  - `loader.py` — `load_ledger(session, entries)` upserts via Postgres
    `INSERT … ON CONFLICT (dedupe_key) DO UPDATE`. `compute_dedupe_key()` =
    `sha256(account ⃗ date ⃗ signed_amount ⃗ normalized_description)` (NUL-joined
    to avoid concat collisions). Money is `Decimal`, quantized to 2 dp before
    hashing **and** storing so `-12.5` and `-12.50` collapse to one row. Signed
    convention preserved (negative = money out). Accepts `scripts.ledger.LedgerEntry`
    (coerces its `source` field to `account`). In-batch duplicates are collapsed
    before the upsert.
  - `__init__.py` — package docstring (placement rationale).
- **`backend-python/tests/test_loader.py`** — synthetic-fixture suite: pure-logic
  dedupe-key tests + Postgres integration tests (transactional, rolled back per
  test) covering double-load idempotency, field/sign mapping, in-batch dedupe,
  re-import update-in-place, empty-ledger no-op, and the `source`-field coercion.
- **Docs:** `backend-python/README.md` (Key files + How it fits),
  `docs/STRUCTURE.md` (tree + CHANGELOG), the design doc CHANGELOG (§5 placement
  note), and `plans/agent_checklist.md` (P3.1 → `[x]`).

## Feature mapping

Implements **P3.1** (Wave 0.5 — Ingestion → DB + precompute). Provides the write
path that fills `transactions`, which the Wave-1 view endpoints (P4.*) read.
Realizes DA-19 (re-import idempotency key) and the `api-data-pulls.md`
"idempotent re-import" + "`Decimal` money" rules.

## Happy-path verification (dedupe proof)

**Playwright screenshot** — the loader's happy path re-run on this branch (Postgres healthy → `alembic upgrade head` → all **14 loader tests pass**, incl. `test_double_load_is_idempotent`):

![P3.1 loader happy-path proof](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/51924969a1a68c3d5b5d3a0851e90e6c1c5ff70c/pull_requests/evidence/p3-1-load-ledger/proof.png)

Ad-hoc script against the live Postgres (`docker compose up -d` + `alembic
upgrade head`), loading the 4-row synthetic ledger **twice** in a rolled-back
transaction:

```
initial rows: 0
after load #1 -> processed 4 | rows: 4
after load #2 -> processed 4 | rows: 4
distinct dedupe_keys: 4
DEDUPE PROOF: PASS
```

Row count is identical after the second load (4 → 4) and there are exactly 4
distinct `dedupe_key`s — re-import did not duplicate. All amounts are synthetic.

## Test plan (gate results)

- **Python** (from `backend-python/`): `uv run ruff check . && uv run ruff
  format --check . && uv run pytest …` → **56 passed, coverage 99.38%** (≥80;
  loader at 100%). Includes the double-load-dedupe test passing against Postgres.
- **Parity** (from `contracts/`): `npm run test:parity` → **46 passed, 15
  skipped, 18 todo** (GREEN; unchanged — no API/schema change). TS backend +
  frontend untouched.
- **Root ingestion** (from repo root): `uv run pytest` → **56 passed**.

## Checklist

- [x] Idempotent loader upserts on the DA-19 dedupe key; re-import yields no dupes.
- [x] `Decimal` money; signed convention preserved (negative = money out).
- [x] Synthetic fixtures only — no real balances/accounts/transactions anywhere.
- [x] Python gate green ≥80% (incl. Postgres double-load test); parity stays green.
- [x] README + `docs/STRUCTURE.md` + design-doc CHANGELOG updated; P3.1 marked `[x]`.
- [x] No HTTP endpoint added → OpenAPI/parity surface unchanged (BE-PY scope).
