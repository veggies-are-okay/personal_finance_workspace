---
paths:
  - "scripts/**/*.py"
  - "**/ingest/**"
  - "**/adapters/**"
---


# API and Data-Pull Conventions

All code that calls external APIs, pulls data, or ingests financial statements must follow these practices.

## 1. Design with limits in mind

- **Rate limits:** Respect provider rate limits (requests per second/minute). Use backoff, throttling, or batching; never assume unlimited throughput.
- **Result limits:** Prefer bounded requests (e.g. `limit`, `max_results`, `page_size`) over unbounded "get everything" calls.
- **Time/scope limits:** Use date ranges, cursors, or pagination so pulls are finite and repeatable.

When implementing a new integration, check the provider's docs for rate limits and recommended batch sizes before coding.

## 2. Sample-first: understand the pull before scaling

- **First attempt:** Pull a **small sample** (e.g. 1–10 records, one page, or a narrow time window) to validate:
  - Response shape and schema
  - Pagination/cursor behavior
  - Error and edge cases
  - Actual rate limits in practice
- **Then** implement the full pull (pagination, loops, retries) using the patterns validated on the sample.
- Prefer a dedicated "sample" or "dry run" mode (env flag or CLI arg) that runs with minimal volume for testing.

## 3. Persist and cache all data pulls

- **Persist:** Every data pull must be written to durable storage (files, object storage, or a database) before further processing. Do not rely on in-memory data as the only copy.
- **Cache:** Use a cache (local file, SQLite, Redis, or object storage) so that:
  - Repeated runs can reuse already-fetched data when appropriate.
  - Cache keys include scope (e.g. endpoint, params, date range) so invalidation is clear.
- Document where data is stored and how to refresh or clear the cache.

### Example pattern (pseudocode)

```python
# 1. Sample first
SAMPLE_SIZE = 5
sample = api.get_items(limit=SAMPLE_SIZE)
validate_schema(sample)
# 2. Full pull with limits and persistence
for page in api.paginate(page_size=100):
    path = cache_path(api.name, page.cursor)
    save_json(path, page.items)
    if rate_limit_remaining_low():
        sleep(backoff_seconds)
```

---

## Statement & document ingestion

Raw bank and credit-card statements arrive in **different per-source formats** and use **incompatible sign conventions**. They must be normalized into a single ledger schema before any analysis.

### Canonical signed-amount convention

> **NEGATIVE = money out (expense/charge/debit). POSITIVE = money in (payment/credit/deposit).**

Every source must be mapped to this convention during ingestion.

### Per-source format reference

| Source file | Raw columns | Date format | Raw sign convention |
|---|---|---|---|
| `amex.csv` | `Date`, `Description`, `Amount` | `MM/DD/YYYY` | Positive = charge (money out) |
| `chase_credit_card.csv` | `Date of Transaction`, `Merchant Name or Transaction Description`, `Amount` (produced by `scripts/extract_chase_statements.py` from PDF statements) | `MM/DD/YYYY` | Positive = purchase (money out) |
| `checking.csv` | 3 metadata header lines, then: `Transaction Number`, `Date`, `Description`, `Memo`, `Amount Debit`, `Amount Credit`, `Balance`, `Check Number` | `MM/DD/YYYY` | Debit column = negative, Credit column = positive |
| `elan_credit_card.csv` | `Date`, `Transaction` (`CREDIT`/`DEBIT`), `Name`, `Memo`, `Amount` | `YYYY-MM-DD` | DEBIT amount = negative, CREDIT amount = positive |

### Normalization rules

Apply these transforms to map each source onto the canonical convention:

- **amex.csv:** Negate `Amount` (raw positive charge becomes negative money-out).
- **chase_credit_card.csv:** Negate `Amount` (raw positive purchase becomes negative money-out).
- **checking.csv:** Skip the 3 metadata header lines. Combine columns: `signed_amount = Amount Credit - abs(Amount Debit)`. The result is already positive-in / negative-out if the raw debit values are stored as negatives; verify before relying on this.
- **elan_credit_card.csv:** `Amount` as-is (DEBIT is already negative, CREDIT is already positive — matches canonical directly).

### Ingestion principles

1. **Sample first:** Parse a small slice of each source file to validate column names, date parsing, and sign behavior before running the full file.
2. **Validate against invariants where they exist:** For example, `scripts/extract_chase_statements.py` asserts that the sum of parsed purchase rows equals the "Purchases" total printed on the statement. Apply the same cross-check discipline to any source that has a verifiable total.
3. **Use `Decimal` for all monetary values.** Never use `float` for money.
4. **Persist normalized output as CSV** (or to the database) before further processing. Raw source files are never modified.
5. **Make re-import idempotent:** Deduplicate on a stable key (e.g. date + description + amount, or a source-provided transaction ID) so that re-running the ingestion pipeline does not create duplicate ledger rows.
6. **No real financial values in code, tests, or rules.** Use synthetic placeholder amounts in any example or test fixture.
