# docs

Committed **markdown** documentation **and** gitignored **real data**.

**Committed (markdown only):**
- `STRUCTURE.md` — canonical repo layout (kept in sync on every merge).
- `setup.md` — local Postgres / environment bring-up.
- `qa.md` — devils-advocate hardening decisions.
- `YYYY-MM-DD-*.md` — dated design specs (e.g. `2026-05-24-data-connectors-and-frontend-design.md`).

**Gitignored (real financial data — never committed):** `bank_statements/`, `gemini_investments_conversation/`, `paystubs/`, `etrade_stocks_portfolio.csv`, and any `*.csv/*.pdf/*.png` under `docs/`. Committed docs must contain **no** real account numbers, balances, or transactions (`.claude/rules/data-privacy.md`). New docs get a `YYYY-MM-DD` filename prefix and a top CHANGELOG.
