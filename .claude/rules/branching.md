
# Branching & Document Conventions

## Branch naming

```
{yyyy}-{mm}-{dd}-<TYPE>/<feature-slug>
```

Valid TYPE values:

| TYPE | When to use |
|---|---|
| `FE` | Frontend-only changes (React/Vite/Tailwind) |
| `BE` | **Any** change that touches the API contract or shared behavior — use this to preserve backend parity |
| `BE-PY` | Python backend internals only; does **not** affect the shared API contract |
| `BE-TS` | TypeScript backend internals only; does **not** affect the shared API contract |
| `DB` | Database migrations (Alembic) or schema changes |
| `DOCS` | Documentation only |
| `DEPLOY` | Deployment config, CI/CD, environment setup |
| `INFRA` | Infrastructure (Docker, networking, secrets management) |

**Rule:** Use `BE` (both backends, one branch) for ANY change to routes, schemas, status codes, or error shapes. Use `BE-PY` / `BE-TS` only when the change is purely backend-internal and cannot be observed through the shared API contract.

One feature per branch. Merge to `main` only after the relevant quality gate(s) and the parity gate pass.

## Quality gates (must pass before merge)

- **Python backend (`BE` or `BE-PY`):** Run from `backend-python/`:
  ```bash
  uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
  ```
- **TypeScript backend (`BE` or `BE-TS`):** Run from `backend-ts/` per project convention.
- **Parity gate (`BE` branches):** Routes, schemas, status codes, and error shapes must be at strict 1:1 parity between `backend-python/` and `backend-ts/` before the branch merges.
- **Root scripts:** Run from the repo root: `uv run pytest`.

## Dated documents

- New committed documents get a `YYYY-MM-DD` filename prefix (e.g. `2026-05-24-api-design.md`).
- When an existing document is updated across a conversation, add or update a **CHANGELOG** block at the top of the file with: date, sections touched, and 2–4 sentences explaining why the change was made.
