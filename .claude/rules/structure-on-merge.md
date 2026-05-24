---
paths:
  - "docs/STRUCTURE.md"
  - "README.md"
---


# Repository Structure (end-state and on-merge)

## Canonical structure

The **single source of truth** for the repository directory layout is **`docs/STRUCTURE.md`**. It describes the target end-state of the project and must be kept in sync with the actual repo at all times.

## When to update

- **On merge:** When a feature branch is merged into `main`, update **both**:
  1. **README.md**: high-level project description, setup, and usage.
  2. **docs/STRUCTURE.md**: directory tree and short description of each top-level directory and key files.

- **Scope of updates:** Add or remove only what the merged branch actually changed — new or removed top-level dirs, new or removed key files under `backend-python/`, `backend-ts/`, `frontend/`, `scripts/`, `docs/`, etc. Do not rewrite the entire file unless doing a deliberate full-sync pass.

## Why

- New contributors and agents can rely on one place for "what lives where."
- Keeps the 200-foot view accurate after each delivery increment.
- Same discipline as README: merge = docs refresh.

## Where it lives

- **Structure content:** `docs/STRUCTURE.md`
- **Task SSOT:** `plans/agent_checklist.md`
- **PR docs:** `pull_requests/<slug>.md`
- **This rule:** `.claude/rules/structure-on-merge.md`

Agents and humans should update `docs/STRUCTURE.md` whenever they merge a branch that changes the repository layout; treat it as part of the same "update docs on merge" step as README.
