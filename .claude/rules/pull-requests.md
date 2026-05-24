# Pull Requests & README Maintenance

Applies to every PR into `main`. `main` is protected: PR-based merges only, and all four CI checks (`python-backend`, `ts-backend`, `frontend`, `parity`) must be green before merge (`.github/workflows/ci.yml`). The PR body is mirrored to `pull_requests/<slug>.md` (see `branching.md`, `structure-on-merge.md`, and the `branch-finalization` skill). **No real financial data** in any PR body, screenshot, log, or PR doc — synthetic only (`data-privacy.md`).

## 1. READMEs stay current (every PR)

- The repo has a **top-level `README.md`** and a **`README.md` in every first-level directory** that holds code or canonical content (`frontend/`, `backend-python/`, `backend-ts/`, `contracts/`, `scripts/`, `docs/`, `config/`, `plans/`, `tests/`).
- **A PR must update the README of every area it touches.** If a PR adds/removes a module, command, env var, endpoint family, or changes how a component is run/tested, the relevant README(s) change in the **same PR**. (This is the same "docs on merge" discipline as `structure-on-merge.md`, applied to READMEs too.)

### README best practices

**Top-level `README.md`:** one-paragraph what + why; the dual-backend-parity architecture in 2–3 sentences (+ a Mermaid diagram per `mermaid.md`); a **quickstart** (clone → `docker compose up -d` → run each component) with copy-pasteable commands; a **repo map** table linking to each component README and to `docs/STRUCTURE.md`, `plans/agent_checklist.md`, and `.claude/rules/`; the quality-gate + PR rules in brief.

**Component `README.md`** (each first-level dir): **Purpose** (one line); **Run & test** (exact commands, incl. the coverage gate); **Key files/modules** (short table); **How it fits** (its role in the parity architecture / data flow); **Gotchas** (e.g. "two uv projects", "`synchronize:false`", "money is a decimal string"). Keep it scannable; link to the spec/contract rather than duplicating.

Write the README a new contributor with zero repo context could follow. Prefer links over duplication; keep diagrams in Mermaid.

## 2. PR description — scale detail to the change size

Count the files changed (`git diff --name-only main... | wc -l`) and pick the tier. **Always** map the technical change to the **high-level feature(s)** it serves (which screen / capability / checklist phase), not just "what changed."

| Tier | Files changed | Granularity of the "Changes" section |
|------|---------------|--------------------------------------|
| **Small** | **≤ 5** | Walk through **each individual file** — what it does and why. |
| **Medium** | **6–10** | Group by **subdirectory / module**; summarize each group. |
| **Large** | **> 10** | **High-level / conceptual by realm** (e.g. "the transactions read path", "the Plaid adapter") — discuss the design, not every file. |

Every PR body / `pull_requests/<slug>.md` includes: **H1 title · Summary · Changes (at the tier granularity) · Feature mapping (change → high-level feature) · Happy-path verification (§3) · Test plan (gate results) · Checklist.** Keep under ~4000 chars.

## 3. Happy-path verification — *prove the feature works*

Beyond green gates, every feature-bearing PR shows **evidence the happy path actually works**, choosing the method(s) that fit the change. Capture artifacts under the PR doc (link images/log excerpts; synthetic data only).

| Change type | Required evidence (pick what fits) |
|-------------|-------------------------------------|
| **Frontend** (screen/flow) | A **Playwright screenshot** of the working screen/state (loading/empty/error covered where relevant), against the mock or a live backend. |
| **Backend endpoint** | The **OpenAPI/Swagger** entry (FastAPI `/openapi.json`, NestJS `/openapi.json`) **+ a Playwright-MCP (or curl) ping** of the endpoint showing the expected response body/status. For a **parity** change, show **both** backends returning identical responses. |
| **Infra / services** | **`docker compose` container logs** (services healthy) and/or **app log** screenshots showing the expected behavior. |
| **Data / ingestion / DB** | Output of an **ad-hoc query script** (e.g. row counts, dedupe proof) or a log excerpt demonstrating the invariant. |

Rules of thumb: prefer **observable behavior** (a real request/response, a rendered screen, a query result) over asserting internals; for any API/parity change, the verification must demonstrate the **shared contract** (same shape from both backends); never paste real balances/transactions/account numbers — use synthetic fixtures or redact.

## 4. Merge

Open the PR (`gh pr create --base main`), let the four checks run, and **merge only on green** (branch protection enforces this). Finalize via the `branch-finalization` skill (gates → PR doc → commit → `--no-ff` merge). Update `docs/STRUCTURE.md` + READMEs in the same PR when layout changes.
