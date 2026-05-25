# INFRA — env-overridable parity-harness ports (parallel-safe gate)

## Summary
The cross-backend parity harness (`contracts/`) hardcoded the four ports it boots backends on (`8765`/`3765` and the DB-down pair `8766`/`3766`). Two `npm run test:parity` runs on one machine therefore collided, blocking parallel execution. This makes the ports env-overridable (defaults unchanged), so independent parity runs — e.g. **parallel checklist subagents**, each in its own git worktree against its own Postgres database via `DATABASE_URL` — can run the full gate concurrently without contention. CI behavior is byte-for-byte unchanged (it sets nothing, so it gets the old defaults).

## Changes (small PR — by file)
- **`contracts/src/backends.ts`** — added an `envPort(name, fallback)` reader; `PY_PORT`/`TS_PORT`/`PY_DOWN_PORT`/`TS_DOWN_PORT` now resolve from `PARITY_PY_PORT`/`PARITY_TS_PORT`/`PARITY_PY_DOWN_PORT`/`PARITY_TS_DOWN_PORT`, falling back to the original dedicated ports. The `*_BASE` URLs derive from these unchanged. No test logic touched.
- **`contracts/README.md`** — new "Running several parity suites in parallel" subsection documenting the four env vars + that DB isolation is via `DATABASE_URL`.
- **`pull_requests/evidence/parity-harness-parallel-ports/proof.png`** — the happy-path screenshot below.

## Feature mapping
Process/infra enabler: unblocks **parallel** execution of the remaining Wave-1 view endpoints (P4.3–P4.6) and later parallel stages (Wave 2/3) by letting each subagent run the parity gate on its own port block. No API/behavior/schema change — the wire contract is untouched.

## Happy-path verification
The parity gate passes both on the **default** ports (CI's path) and on **overridden** ports (the parallel path), proving the override works and defaults are preserved:

![parity gate green on default and overridden ports](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/121202377cf07825448d71bd811eda8953707c02/pull_requests/evidence/parity-harness-parallel-ports/proof.png)

Teardown was confirmed to free the overridden ports (no leaked listeners on `8771`).

## Test plan
| Gate | Result |
|------|--------|
| contracts `typecheck` (`tsc --noEmit`) | PASS |
| contracts `format:check` (prettier) | PASS |
| contracts `test:parity` — default ports | **54 passed**, 13 skipped/13 todo |
| contracts `test:parity` — `PARITY_*_PORT` overrides | **54 passed**, 13 skipped/13 todo |
| python-backend / ts-backend / frontend | unaffected (no source touched) — verified green by CI on this PR |

## Checklist
- [x] Ports env-overridable; defaults (and CI) unchanged.
- [x] Verified green on both default and overridden ports; ports freed on teardown.
- [x] README documents the env vars + `DATABASE_URL` DB isolation.
- [x] No API/behavior/schema change; synthetic-only.
- [ ] Four CI checks green (verified on the PR before merge).
