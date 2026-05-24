# Checklist Flow — Staged Parallel Execution

> CHANGELOG
> - 2026-05-24: Initial flow. Stages, merge order, and running tally for `checklist-phase-runner-parallel`. — Foundation pass.
> - 2026-05-24: Re-staged for the data-connectors & frontend program (3 waves). — Connectors pass.

Drives the **`checklist-phase-runner-parallel`** skill. Within a stage, independent subsections run as parallel subagents (one per subsection); stages run sequentially; the meta-runner merges each stage's branches in the listed order, then ticks the running tally. Subsection headings/tasks live in `plans/agent_checklist.md`; contract/architecture in `docs/2026-05-24-data-connectors-and-frontend-design.md`.

## Stage → subsections mapping

| Stage | Wave | Subsections (parallel) | Merge order |
|-------|------|------------------------|-------------|
| 1 | 0 | P2.1, P2.2 | ci-rewrite-hygiene → api-contract-mock |
| 2 | 0 | P2.3 | db-schema-item-store |
| 3 | 0.5 | P3.1 → P3.2 *(sequential; P3.2 needs P3.1)* | load-ledger → precompute-analytics |
| 4 | 1 | P4.1, P4.2, P4.3, P4.4, P4.5, P4.6 | transactions → budget → networth → investments → debt → goals |
| 5 | 1 | P5.1, P5.2 | fe-core-screens → fe-settings-connections |
| 6 | 2 | P6.1 → (P6.2, P6.3) → P6.4 | connections-api → plaid-adapter → rentcast-adapter → settings-wiring |
| 7 | 3 | P7.1, P7.2, P7.3 | docker-dual-frontend → parity-hardening → security-review |

> **Independence notes.** Stage 1: CI and the contract are independent (parallel-safe). Stage 4: the six view endpoints touch different routes and never edit the frozen OpenAPI (each only adds its own parity-test file), so they are parallel-safe. Stage 5 (frontend, built against the **Prism mock**) may actually begin as soon as Stage 1's contract is merged, in parallel with Stage 4; it only needs the live endpoints to **wire** at the end. Stage 6: `P6.1` (connections base + Item store) must merge before the Plaid/RentCast adapters; `P6.2`/`P6.3` are then parallel.

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

*Last updated: (set by runner)*
