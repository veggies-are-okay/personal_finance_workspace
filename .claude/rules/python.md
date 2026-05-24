---
paths:
  - "**/*.py"
---


# Python Conventions

- **Environment:** Use uv. `uv sync`, `uv add <pkg>`, `uv add --dev <pkg>`, `uv run <cmd>`.
- **Lint/format:** Run from `backend-python/`:
  ```bash
  uv run ruff check .
  uv run ruff format --check .
  ```
- **Tests:** When Python behavior changes, run the full quality gate from `backend-python/`:
  ```bash
  uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-report=term-missing:skip-covered --cov-branch --cov-fail-under=80
  ```
- **Root-level scripts:** Repo-level data-prep utilities live in `scripts/` and are managed under the root `pyproject.toml`. Run their tests from the repo root:
  ```bash
  uv run pytest
  ```
- **Testing style:** Follow `.claude/rules/testing_python.md` — meaningful behavior tests, minimal mocking, real validation and route wiring where practical.
- **Types:** Run `uv run ty check` or `uv run pyright` if configured.
- **Style:** Follow Ruff defaults unless `pyproject.toml` says otherwise.
- **Parity:** Any Python change that affects the API contract (routes, schemas, status codes, error shapes) must be mirrored in `backend-ts/` in the same branch; see `.claude/rules/backend-parity.md`.
