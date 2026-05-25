# scripts (statement ingestion + precompute)

**Purpose:** repo-level data-prep utilities that turn raw bank/credit statements into one **normalized, signed-amount ledger** and **precompute** the deterministic analytics the backends serve. This is the **root uv project** (`personal-finance-ingest`), separate from `backend-python/`.

## Run & test (from the repo root)

```bash
uv sync
uv run python scripts/extract_chase_statements.py   # Chase PDF → normalized CSV
uv run python scripts/extract_paystubs.py            # pay stubs → paystubs.csv
uv run pytest                                        # tests in tests/ (synthetic fixtures)
```

## Key files

| Path | Role |
|------|------|
| `extract_chase_statements.py` | Parse Chase PDF statements → normalized CSV (validated against the statement's printed total). |
| `extract_paystubs.py` | Parse pay stubs → `docs/paystubs/paystubs.csv` schema. |
| `ledger.py` | Per-source normalizers (Amex/Chase/Elan/Checking) + a combined signed-amount ledger loader. |
| `evidence_term_shot.sh` | Renders captured terminal output → a PNG via the Playwright CLI — the PR happy-path proof screenshot (`.claude/rules/pull-requests.md` §3). |

## How it fits

The data flow is: **raw statements → normalize (one signed-amount convention, negative = money out) → precompute (categorization, transfer/recurring detection, 50/30/20 buckets, savings rate, monthly aggregates) → Postgres**. Both backends then serve **thin reads** of those tables, so the heavy logic lives here **once** instead of being reimplemented in TypeScript (keeps backend parity trivial). See `docs/2026-05-24-data-connectors-and-frontend-design.md` §5.

**Gotchas:** local-only runs may read the **gitignored real** statements under `docs/`; committed tests must use **synthetic** fixtures in `tests/fixtures/` only (`.claude/rules/data-privacy.md`). Money is `Decimal`; re-import is idempotent on a deterministic dedupe key.
