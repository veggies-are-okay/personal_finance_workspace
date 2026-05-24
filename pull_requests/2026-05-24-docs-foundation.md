# PR: Project foundation — dual-backend parity scaffold

**Branch:** `2026-05-24-DOCS/foundation`
**Base:** `main`
**Date:** 2026-05-24

## Summary

Establishes the foundation for the personal finance app. Sets the architecture (one React/Vite/Tailwind frontend + two backends — FastAPI and NestJS — kept at strict 1:1 parity over shared Postgres), the rule and skill libraries, the repo skeleton, and a working Chase PDF statement extractor. No application code yet; implementation is driven by `plans/agent_checklist.md`.

## Changes

- **Guidance:** `CLAUDE.md` (full briefing + architecture diagram), `docs/STRUCTURE.md` (canonical layout), `plans/` (high-level plan, `agent_checklist.md`, `checklist_flow.md`).
- **Rules** (`.claude/rules/`, Claude-native): 3 always-on (`backend-parity`, `data-privacy`, `branching`) + 10 path-scoped via `paths:` frontmatter.
- **Skills** (`.claude/skills/`): `checklist-phase-runner`(+parallel), `branch-finalization`, `parity-auditor`, `bug-hunter`, `devils-advocate`.
- **Scaffold:** `backend-python/` + root `pyproject.toml` (two uv projects), `backend-ts/`, `frontend/`, `contracts/` placeholders; `docker-compose.yml` (Postgres); `.env.example`; `.mcp.json.example`; `config/accounts.example.yaml`.
- **Ingestion:** `scripts/extract_chase_statements.py` + `tests/`.
- **Privacy:** real statements, the planning conversation, screenshots, EDA notebooks, `accounts.yaml`, `.env`, and `.mcp.json` (live API key) are gitignored.

## Test plan

- [x] Chase extractor: 31 tests pass (`uv run pytest`)
- [x] Privacy: `git add -n` confirms no real financial data, notebook outputs, or API key tracked
- [x] All 13 rules + 6 skills have valid frontmatter; no dangling `.cursor`/`.mdc` references
