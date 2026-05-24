# Pull Requests, Review & README Maintenance

The reference for **how PRs are authored, verified, and reviewed**, and **how READMEs stay alive**. The `branch-finalization` skill **executes** this rule end-to-end. `main` is protected: **PR-based merges only**, and all four CI checks (`python-backend`, `ts-backend`, `frontend`, `parity`) must be green before merge (`.github/workflows/ci.yml`). **No real financial data** in any PR body, screenshot, log, or PR doc — synthetic only (`data-privacy.md`). See also `branching.md`, `structure-on-merge.md`, `backend-parity.md`.

---

## 1. README best practices & upkeep

The repo keeps a **top-level `README.md`** and a **README in every first-level directory** that holds code or canonical content. **Every PR updates the README of each area it touches** (same "docs on merge" discipline as `structure-on-merge.md`) — if a PR adds/removes a module, command, env var, endpoint family, or changes how a component runs/tests, the relevant README(s) change **in that PR**.

**Top-level README = navigation + map.** Ideal order: title → one-line what/why → highlights → quickstart (copy-pasteable) → usage → repo/component map (table linking each component README + `docs/STRUCTURE.md` + `plans/`) → requirements/config (env vars) → quality gates → contributing/PR rules → privacy note. Put "what is it / can I run it / what next / where's help" in the first screenful.

**Component README = local operating manual.** Each first-level dir: **Purpose** (one line) · **Run & test** (exact commands incl. the coverage gate) · **Key files** (short table) · **How it fits** (its role in the parity architecture / data flow) · **Gotchas** (e.g. "two uv projects", "`synchronize:false`", "money is a decimal string"). Link to the spec/contract rather than duplicating.

**Keep them from rotting:** single source of truth; **link, don't duplicate** (root orients, component operates, deep workflows live in `docs/` and are linked); examples are copy-pasteable and current; stale sections are removed, not accumulated.

**README review rubric:** first paragraph says what it is in plain language; answers what/why/how; commands are copy-pasteable and were recently true; prerequisites + env vars + ports match the code; links resolve; **no secrets or real data**; (monorepo) root has a component index and components don't duplicate shared setup. 60-second smell test: *what is this · can I run it · what next · where's help.*

**Anti-patterns:** wall of text; missing quickstart; outdated commands/paths; duplicated instructions across READMEs (drift); no concrete examples; API dump instead of a guide; secrets/real data; broken links.

---

## 2. PR description — scale detail to change size

Count files (`git diff --name-only main... | wc -l`) and pick the tier. **Always** map the change to the **high-level feature(s)** it serves (which screen / capability / checklist phase), not just "what changed." Keep PRs **focused** (one concern) and reasonably small.

| Tier | Files | "Changes" granularity |
|------|-------|-----------------------|
| **Small** | **≤ 5** | Walk through **each individual file**. |
| **Medium** | **6–10** | Group by **subdirectory / module**. |
| **Large** | **> 10** | **High-level / conceptual by realm** — discuss the design, not every file. |

Every PR body / `pull_requests/<slug>.md`: **H1 title · Summary · Changes (at tier granularity) · Feature mapping · Happy-path verification (§3) · Test plan (gate results) · Checklist.** Under ~4000 chars.

---

## 3. Happy-path verification — *prove it works*

Beyond green gates, every feature-bearing PR shows **evidence the happy path works**, choosing the method(s) that fit (synthetic data only; link artifacts in the PR doc).

| Change type | Evidence |
|-------------|----------|
| **Frontend** | A **Playwright screenshot** of the working screen/state (loading/empty/error where relevant), against the mock or a live backend. |
| **Backend endpoint** | The **OpenAPI/Swagger** entry + a **Playwright-MCP (or curl) ping** showing the expected response/status. For a **parity** change, show **both** backends returning identical responses. |
| **Infra / services** | **`docker compose` container logs** (services healthy) and/or **app log** screenshots showing expected behavior. |
| **Data / ingestion / DB** | Output of an **ad-hoc query script** (row counts, dedupe proof) or a log excerpt demonstrating the invariant. |

Prefer **observable behavior** (real request/response, rendered screen, query result) over asserting internals. Never paste real balances/transactions/account numbers.

---

## 4. Review (author self-review, then reviewer pass)

**Author self-review before opening** (Google: fix everything you can first): read every changed file as a reviewer would; remove debug/dead/commented code; add inline comments where intent is non-obvious; confirm linters/formatters pass and no unrelated/whitespace churn; new behavior has meaningful tests (a bugfix has a test that fails without the fix); the PR description states what/why/how/risks + which gates were run.

**Reviewer checklist** (the `branch-finalization` skill runs this — optionally via the `code-review` or `pr-review-toolkit:review-pr` skills):
- **Correctness:** matches the spec/feature; edge cases + error conditions handled; **no silent failures** (no swallowed exceptions); external APIs used per contract.
- **Tests:** meaningful (assert behavior, not "no exception"), readable, stable; bugfix has a failing-without-fix test; ≥80% coverage gate met.
- **Readability/maintainability:** clear names; reasonable decomposition; comments explain *why*; no needless duplication; consistent with existing patterns.
- **Parity (this repo):** API/behavior change exists in **both** backends + `contracts/` parity test + clean OpenAPI diff; money(decimal-string)/dates(ISO-Z)/enums/null match Appendix A of `agent_checklist.md`.
- **Security:** no secrets/tokens/PII in code or logs; external input validated; parameterized queries; authz checked; errors don't leak internals. Mark as `issue(security, blocking)`.

**Comment style — Conventional Comments** (`label(subject): discussion`): `issue` (blocking: correctness/security/major design), `suggestion`/`question`/`thought` (non-blocking), `nit` (trivial, never blocking). Be specific, give the *why* and a concrete alternative, stay kind.

**Block only on** correctness, security, or major design problems. **Do NOT block on** style already enforced by linters, personal preference, or speculative refactors — mark those `nit`/`suggestion`.

---

## 5. Merge

**Every PR is created and finalized via the `branch-finalization` skill — never hand-roll `gh pr create` / `gh pr merge` ad hoc.** A `PreToolUse(Bash)` hook (`.claude/hooks/pr-create-reminder.sh`, wired in `.claude/settings.json`) injects this reminder whenever a command runs `gh pr create`. The skill's flow: `gh pr create --base main` → ensure the **four checks are green** → merge (`gh pr merge --merge`). Branch protection enforces green-before-merge; the author may merge their own PR (solo repo, 0 required approvals) once checks pass and self/reviewer review is clean. Update `docs/STRUCTURE.md` + the touched READMEs **in the same PR** when layout/usage changed. The `branch-finalization` skill performs this flow.
