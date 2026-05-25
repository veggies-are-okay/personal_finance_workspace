# P6.1 — Connections API + encrypted Item store + JWT-verified webhook

## Summary

Implements the **Plaid connection lifecycle** in **both** backends at strict 1:1 parity (type `BE`): create a Link token, exchange a `public_token` for an Item (encrypting the `access_token` at rest), list per-source connection state, and receive JWT/JWKS-verified Plaid webhooks. Adds an OAuth redirect route with a strict allowlist (no open redirect). The canonical OpenAPI already declared these paths (P2.2, frozen — DA-25); this branch turns them on in `contracts/` and proves cross-backend parity + the security invariants.

## Changes (by realm)

**Both backends (parity twins — `backend-python/app/connections/`, `backend-ts/src/connections/`):**
- Routes: `POST /api/v1/connections/link-token`, `POST /api/v1/connections/exchange`, `GET /api/v1/connections`, `POST /api/v1/connections/webhook`, plus `GET /api/v1/connections/oauth` (allowlisted redirect, excluded from OpenAPI). Wired into `main.py` / `app.module.ts`.
- **Token-at-rest (DA-12):** AES-256-GCM, key = base64 `APP_ENCRYPTION_KEY` (32 bytes), on-disk layout `nonce(12)‖ciphertext‖tag(16)`. **Byte-compatible across backends** (`cryptography.AESGCM` ↔ `node:crypto`) — a token written by either decrypts in the other. Stored only as `plaid_items.access_token` BYTEA; never returned.
- **Webhook (DA-11):** ES256 JWT in `Plaid-Verification`, key fetched from `/webhook_verification_key/get` (JWKS cached by `kid`); verifies signature + `iat` freshness (5 min) + raw-body SHA-256 == `request_body_sha256`; rate-limited. Unverified/forged/unsigned → canonical **401**. Body schema-validated after verification → **422** on bad shape.
- **Plaid client injected** (`PLAID_GATEWAY` / `get_gateway`): `PLAID_FAKE=1` selects a network-free fake gateway so CI/parity is hermetic — no live Plaid call.
- **Redaction (DA-14):** structured logging scrubs `access/public/link` tokens (and secret-ish keys) everywhere.
- Reused the canonical error layer: added `UnauthorizedError` (FastAPI handler → 401) and `CanonicalUnauthorizedException` (NestJS). NestJS bootstrap gains `rawBody: true` for webhook body hashing.

**contracts/:** flipped the 4 connection paths into `IMPLEMENTED_PATHS` (structural OpenAPI diff now covers them, clean); `test/connections.parity.test.ts` asserts the value + security invariants; the harness boots both backends with `PLAID_FAKE=1` + a synthetic shared key and captures logs to `contracts/.parity-logs/` (gitignored) for the log-scrub test.

## Feature mapping

Backs the Settings / Data-Sources **connect flow** (P5.2 FE): the Connect/Reconnect button drives link-token → Plaid Link → exchange (encrypted store); the Settings screen reads `GET /connections` for per-source mode/status; Plaid pushes updates to the verified webhook. Unblocks the live Plaid adapter (P6.2).

## Happy-path verification

Ran the **real Plaid Sandbox** end-to-end locally (`.env` sandbox creds): `/sandbox/public_token/create` → `POST /exchange` (HTTP 200 `{item_id,status:"connected"}`) → `GET /connections` shows `transactions` **connected** → DB inspection confirms the BYTEA column holds 79 ciphertext bytes with **no plaintext token** and the response carries no `access_token`. Tokens redacted in the transcript.

![P6.1 Plaid Sandbox proof](https://raw.githubusercontent.com/veggies-are-okay/personal_finance_workspace/89389d1cedf438b0a2d4766bcfc54d358bfb5d7f/pull_requests/evidence/p6-1-connections-api/proof.png)

## Test plan (gate results)

- **python** (`backend-python/`): `ruff check` + `ruff format --check` clean; pytest **218 pass**, **96.7%** coverage (≥80).
- **ts** (`backend-ts/`): `lint` + `format:check` clean; jest **250 pass**, **89.6%** coverage (≥80).
- **parity** (`contracts/`): `npm run test:parity` **79 pass** + clean structural OpenAPI diff. Connections parity proves: identical link/exchange/connections shapes; **no plaintext token at rest**; **cross-backend decrypt** (FastAPI-written ↔ NestJS-written); **forged + unsigned webhook → identical 401**; **log-scrub** (no token in captured logs); **redirect allowlist** rejects a non-allowlisted URI.

## Checklist

- [x] Endpoints implemented in both backends at 1:1 parity (routes/schemas/status/error shapes).
- [x] Token encrypted at rest (AES-256-GCM); no plaintext token in DB or responses (DA-12).
- [x] Webhook JWT/JWKS-verified; unverified/forged/unsigned → canonical 401; body validated; rate-limited (DA-11).
- [x] Tokens never logged/committed; CI hermetic (Plaid faked via `PLAID_FAKE=1`) (DA-14).
- [x] `contracts/` parity tests cover the security invariants; OpenAPI diff clean.
- [x] No schema change (reused P2.3 `plaid_items` + `source_config`); READMEs + `docs/STRUCTURE.md` + checklist updated.
- [x] No real financial data in code/tests/fixtures/PR; synthetic only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
