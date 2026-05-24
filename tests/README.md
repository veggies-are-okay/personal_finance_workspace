# tests

Tests for the **root uv project** (the `scripts/` ingestion utilities). Run from the repo root:

```bash
uv run pytest
# single file:  uv run pytest tests/test_extract_chase_statements.py -q
```

`conftest.py` puts `scripts/` on the import path. `tests/fixtures/` holds **small synthetic CSV fixtures** — never real statements (`.claude/rules/data-privacy.md`). The backends have their own test suites under `backend-python/tests/` and `backend-ts/test/`.
