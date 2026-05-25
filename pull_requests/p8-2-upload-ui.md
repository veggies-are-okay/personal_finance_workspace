# P8.2 — Frontend upload UI + nginx ingest routing (FE)

## Summary

Adds the **file-upload onboarding** half of the epic: a per-source upload control on the Settings / Data Sources screen so the owner drops their raw bank/credit statements, pay stubs, brokerage, account, and loan files and they flow through the already-built Python ingest endpoint (`POST /api/v1/ingest/{source}`) → DB → dashboards. **Ingestion is Python-only**, so nginx routes the ingest path to the FastAPI backend regardless of which frontend instance served the SPA. No backend change.

## Changes (large tier — by realm)

- **API client (`src/lib/api.ts`, `types.ts`):** new `ingestSource(source, files)` POSTs `multipart/form-data` — every file under the `file` field, and **no `Content-Type`** header so the browser sets the multipart boundary. Non-2xx maps to the existing `ApiRequestError` carrying the canonical envelope. New wire types `IngestSource`/`IngestSummary`/`IngestedFile`.
- **Upload UI (`src/features/connections/`):** new `UploadControl` — a labelled file picker that doubles as a **drag-and-drop** target, with per-source `accept`/`multiple` (transactions `.csv,.pdf` ×N · income `.pdf,.csv` ×N · holdings `.csv` · accounts `.yaml,.yml` · loans `.csv`). States: idle → loading → **success** (per-file detected type + rows, `role="status"`) / **error** (canonical message, `role="alert"`). Integrated into each `SourceCard`; `accounts` (no Plaid row) gets a standalone card on `SettingsScreen`. On success it invalidates the screen data — `useApi` gained `keepDataOnReload` so the success summary survives the refetch instead of remounting away. `mocks/handlers.ts` gained an ingest handler (demoable dev + `?scenario=error` 422).
- **nginx (`frontend/nginx.conf.template`):** a more-specific `location /api/api/v1/ingest/` (before the general `/api/`) proxies to `http://backend-python:8000` **regardless of `${BACKEND_UPSTREAM}`**, plus `client_max_body_size 25m` for PDFs — so `:8502` (NestJS-reads) still sends ingestion to FastAPI.

## Feature mapping

Serves **"drop your raw files, get a usable portal"**: the owner onboards every data source from one screen, and the rows immediately feed Budget / Net Worth / Investments / Debt / Goals.

## Happy-path verification

Drove a **synthetic** `.csv` upload through the real UI in an **isolated** compose project (`pf_p82`, own volume + alt ports — the default stack's real-data volume was never touched) on **both** `:8511` (python-reads) and `:8512` (TS-reads): both returned `amex · 3 rows`, proving the TS frontend's ingest also routes to backend-python.

![Settings upload — successful synthetic ingest](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/e321a49f92602412902f1133ca4ec69e9fbd8f94/pull_requests/evidence/p8-2-upload-ui/proof.png)

## Test plan

- `npm run lint` — clean.
- `npm run test -- --coverage` — **84 passing**, **93.0% stmts / 82.2% branch** (≥80% floor). Tests assert: the upload control renders per source with the right `accept`/`multiple`; selecting a file + submitting **fires the multipart request** to the right `/ingest/{source}` (asserts the FormData field + multipart Content-Type, not just a render); success renders the rows summary; a 422 renders the canonical error; drag-and-drop accepts a file; the screen refetches on success.
- `npm run build` — succeeds.
- Backend / TS / parity gates unaffected (no backend change); CI runs them anyway.

## Checklist

- [x] Frontend gate green (lint + Vitest ≥80% + build)
- [x] Upload control per source; multipart request fires to `/ingest/{source}`; success + 422 states covered
- [x] nginx routes ingestion to backend-python for both instances + 25m body cap
- [x] Happy-path screenshot (committed, SHA-pinned)
- [x] README + `docs/STRUCTURE.md` updated; P8.2 marked done in `plans/agent_checklist.md`
- [x] Synthetic data only; default stack/volume untouched
