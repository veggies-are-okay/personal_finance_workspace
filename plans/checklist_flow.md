# Checklist Flow — Staged Parallel Execution

> CHANGELOG
> - 2026-05-24: Initial flow. Stages, merge order, and running tally for `checklist-phase-runner-parallel`. — Foundation pass.

Drives the **`checklist-phase-runner-parallel`** skill. Within a stage, independent subsections run as parallel subagents (one per subsection); stages run sequentially; the meta-runner merges each stage's branches in the listed order, then ticks the running tally. Subsection headings/tasks live in `plans/agent_checklist.md`.

## Stage → subsections mapping

| Stage | Subsections (parallel) | Merge order |
|-------|------------------------|-------------|
| 1 | P0.3 | p0-3-ingestion-remaining-sources |
| 2 | P1.1 | p1-1-postgres |
| 3 | P1.2, P1.3 | p1-2-backend-python-scaffold → p1-3-backend-ts-scaffold |
| 4 | P1.4, P1.5 | p1-4-parity-harness → p1-5-frontend-scaffold |
| 5 | P2.1 | p2-1-schema |
| 6 | P3.1 | p3-1-load-ledger |
| 7 | P4.1, P4.2 | p4-1-transactions-list → p4-2-categorize |
| 8 | P5.1, P6.1, P7.1, P7.2 | p5-1-budgets → p6-1-net-worth → p7-1-loan-payoff → p7-2-goals |
| 9 | P8.1, P8.2 | p8-1-dashboard-transactions → p8-2-remaining-screens |
| 10 | P9.1 | p9-1-openapi-diff-ci |

> Subsections within a stage must be genuinely independent. P1.2/P1.3 (the two backend scaffolds) are parallel-safe because each owns its own tree; the parity harness (P1.4) depends on both, so it is a later stage.

## Running tally

| Stage | Done | Last updated |
|-------|------|--------------|
| 1 | - [ ] | |
| 2 | - [ ] | |
| 3 | - [ ] | |
| 4 | - [ ] | |
| 5 | - [ ] | |
| 6 | - [ ] | |
| 7 | - [ ] | |
| 8 | - [ ] | |
| 9 | - [ ] | |
| 10 | - [ ] | |

*Last updated: (set by runner)*
