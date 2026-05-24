
# Data Privacy

This repo contains the owner's **real** financial data. Treat it as secret.

## What is sensitive (and gitignored)

| Location | Contents |
|----------|----------|
| `docs/bank_statements/` | Real bank/credit CSVs and Chase PDF statements (account numbers, balances, transactions) |
| `docs/gemini_investments_conversation/` | A personal financial-planning conversation (income, balances, loans, strategy) |
| `images/` | Screenshots: pay stub, brokerage portfolio, retirement accounts |
| `config/accounts.yaml` | Seeded account balances / loan figures for the app |

These paths are excluded in `.gitignore` (folders **and** raw `*.csv` / `*.pdf` / `*.png` under `docs/`+`images/`). Verify with `git check-ignore <path>` before assuming something is tracked.

## Rules

- **Never commit** real financial data. Committed documentation under `docs/` is **markdown only** and must not contain real account numbers, balances, or transaction lines.
- **Never paste** real values (account numbers, balances, dollar amounts tied to the owner, transaction descriptions) into source code, test fixtures, PR docs (`pull_requests/`), commit messages, or **MCP queries** (Perplexity/Context7). Research queries describe the problem in the abstract.
- **Tests use synthetic fixtures.** Any committed or CI test must run against small, made-up fixtures under the relevant `tests/` directory — not the real statements.
  - Exception: local-only utilities may read the real gitignored data (e.g. the Chase extractor tests in `tests/` validate against the real PDFs). These are **local-only** and will not run in a clean checkout/CI. Keep them clearly separated from the synthetic-fixture suites.
- **Seeded balances** belong in `config/accounts.yaml` (gitignored). Commit a sanitized `config/accounts.example.yaml` with placeholder/zero values as the template.
- When a new kind of sensitive data is introduced, add its path to `.gitignore` in the same change.

## Why

This is a single-user, local-first app, but the repo may be pushed to a remote. A single committed statement or screenshot leaks the owner's complete financial picture. Privacy failures are not recoverable by a later commit — once pushed, assume it is public.
