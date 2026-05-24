# P0.3 — Ingestion: remaining sources

## Summary

Adds `scripts/ledger.py`: per-source normalizers for the remaining bank/credit
statement formats (Amex, checking, Elan) plus the Chase CSV produced by
`extract_chase_statements.py`, and a combined loader that merges all sources
into one canonical signed-amount ledger.

Canonical convention (`.claude/rules/api-data-pulls.md`):
**negative = money out, positive = money in.** All money is `Decimal`.

## Changes

- **`scripts/ledger.py`** (new)
  - `LedgerEntry` — frozen dataclass: `date`, `source`, `description`, `amount` (signed `Decimal`).
  - `parse_amount` — robust money parsing: thousands separators, surrounding
    quotes/whitespace, optional leading `+`/`-`, sub-dollar `.15`.
  - `normalize_amex` — raw positive charge → negative; payment credits → positive.
  - `normalize_checking` — skips the 3 metadata header lines; uses already-signed
    `Amount Debit`/`Amount Credit`; falls back to `Description` when `Memo` is blank.
  - `normalize_elan` — amount already correctly signed (DEBIT −, CREDIT +); kept as-is.
  - `normalize_chase` — raw positive purchase → negative; refunds → positive.
  - `load_ledger(amex, checking, elan, chase)` — merges all available sources
    (paths are parameters, default to `docs/bank_statements/`; missing/None sources
    skipped) into one list sorted newest-first.
  - `write_csv` + `main` CLI for ad-hoc runs.
  - Defensive: skips header lines re-emitted mid-file (real Amex exports split
    transactions into sections, each repeating the header).
- **`tests/test_ledger.py`** (new) — 18 tests on synthetic fixtures.
- **`tests/fixtures/`** (new) — synthetic CSVs: `amex.csv`, `amex_repeated_header.csv`,
  `checking.csv`, `elan_credit_card.csv`, `chase_credit_card.csv`. Fully fabricated.
- **`plans/agent_checklist.md`** — P0.3 checked off.
- **`docs/STRUCTURE.md`** — dated CHANGELOG line; documents `scripts/ledger.py` and `tests/fixtures/`.
- Applied a `ruff format` pass to pre-existing foundation files
  (`conftest.py`, `scripts/extract_chase_statements.py`,
  `tests/test_extract_chase_statements.py`) that predated the current ruff style.

## Test plan

Commands (repo root):

```
uv run ruff check <tracked files>            # All checks passed!
uv run ruff format --check <tracked files>   # all formatted
uv run pytest                                # 147 passed
```

Coverage of the new module: each normalizer's sign + parsed fields, sub-dollar
amounts, thousands separators, the checking metadata-line skip and Memo
fallback, repeated-header skipping, the combined loader (merge, source tagging,
newest-first sort, missing-source skip), frozen dataclass, and `Decimal` typing.

Note: `uv run ruff check .` / `ruff format --check .` over the *whole* repo also
flag two untracked WIP files from a separate task (`scripts/extract_paystubs.py`,
`tests/test_extract_paystubs.py`). Those are out of P0.3 scope and not included
in this commit; the scoped gate above is clean.

## Checklist

- [x] Normalizers for amex / checking / elan + chase, on the canonical schema.
- [x] Combined loader merges all sources, sorted newest-first.
- [x] Unit tests on synthetic fixtures assert correct sign per source.
- [x] `Decimal` for money; robust amount/date parsing.
- [x] No real financial data in code, tests, fixtures, or this doc.
- [x] Smoke-ran the CLI against real sources (output gitignored, then removed).
