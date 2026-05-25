/**
 * Canonical-contract loader + the "implemented endpoints" allowlist.
 *
 * `openapi.canonical.json` is authored COMPLETE and FROZEN in P2.2 (DA-25): it
 * declares EVERY path the program will ever serve. The two backends, however,
 * implement those paths one `BE` branch at a time. So the structural parity
 * check needs to know which canonical operations are actually live yet — that
 * is what `IMPLEMENTED_PATHS` is for.
 *
 * THIS file (not the frozen OpenAPI) is the one place a Stage-4 endpoint branch
 * edits: when an endpoint is implemented in BOTH backends, add its `path get`
 * (or `path post`) key to `IMPLEMENTED_PATHS`, fill in the matching parity-test
 * stub, and the strict cross-backend structural assertion turns on for it. Until
 * then the operation is present in the canonical doc (so the contract is whole
 * and the FE mock is complete) but is NOT asserted against the backends, so the
 * existing /health parity stays green with no backend impl for the new paths.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { normalizeApi, type OpenApiDocument } from "./normalize";

const HERE = dirname(fileURLToPath(import.meta.url));
/** contracts/src -> contracts/ is one level up. */
export const CANONICAL_PATH = resolve(HERE, "..", "openapi.canonical.json");

/** Load + parse the canonical OpenAPI document. */
export function loadCanonical(): OpenApiDocument {
  return JSON.parse(readFileSync(CANONICAL_PATH, "utf8")) as OpenApiDocument;
}

/**
 * A canonical operation key, "<METHOD> <path>", e.g. "GET /health".
 * Method is upper-cased for readability; comparison is case-insensitive.
 */
export type OperationKey = string;

/** Normalize an operation key for set membership (method upper, path as-is). */
export function opKey(method: string, path: string): OperationKey {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Ingestion carve-out (P8.1).
 *
 * Ingestion/extraction is **Python-owned** and intentionally OUT of the 1:1
 * read-parity contract — analogous to Alembic owning migrations. The
 * upload/extract/load endpoints (`POST /api/v1/ingest/{source}`) live in the
 * FastAPI backend ONLY (they depend on pdfplumber/PyYAML); NestJS does NOT
 * implement them, and they are NOT in `openapi.canonical.json`. So when we diff
 * the Python backend's `/openapi.json` against canonical, any `/api/v1/ingest/*`
 * path must be IGNORED — otherwise the Python-only surface would read as drift.
 * Only the READ API is held at strict parity. See
 * `.claude/rules/backend-parity.md`.
 */
export const INGEST_PATH_PREFIX = "/api/v1/ingest";

/** True if a path is part of the Python-only ingestion surface (carve-out). */
export function isIngestPath(path: string): boolean {
  return (
    path === INGEST_PATH_PREFIX || path.startsWith(`${INGEST_PATH_PREFIX}/`)
  );
}

/**
 * Operations that are LIVE in both backends today and therefore must pass the
 * strict cross-backend structural parity check. Grows one entry per Stage-4
 * `BE` branch as endpoints land. Only `/health` is implemented at P2.2 time.
 */
export const IMPLEMENTED_PATHS: ReadonlySet<OperationKey> =
  new Set<OperationKey>([
    opKey("GET", "/health"),
    opKey("GET", "/api/v1/transactions"), // P4.1
    opKey("GET", "/api/v1/budget"), // P4.2
    opKey("GET", "/api/v1/networth"), // P4.3
    opKey("GET", "/api/v1/investments"), // P4.4
    opKey("GET", "/api/v1/debt"), // P4.5
    opKey("GET", "/api/v1/goals"), // P4.6
    // P6.1 connections API (link/exchange/list + JWT-verified webhook):
    opKey("POST", "/api/v1/connections/link-token"),
    opKey("POST", "/api/v1/connections/exchange"),
    opKey("GET", "/api/v1/connections"),
    opKey("POST", "/api/v1/connections/webhook"),
    // Stage-4 branches append as they implement (DA-25 keeps the OpenAPI frozen):
    // opKey("GET", "/api/v1/sources/transactions"),
    // opKey("GET", "/api/v1/sources/income"),
    // opKey("GET", "/api/v1/sources/holdings"),
    // opKey("GET", "/api/v1/sources/loans"),
    // opKey("GET", "/api/v1/sources/listings"),
  ]);

/** Every "<METHOD> <path>" operation declared in the canonical contract. */
export function canonicalOperationKeys(doc: OpenApiDocument): OperationKey[] {
  const api = normalizeApi(doc);
  const keys: OperationKey[] = [];
  for (const path of Object.keys(api)) {
    for (const method of Object.keys(api[path])) {
      keys.push(opKey(method, path));
    }
  }
  return keys.sort();
}

/** Split canonical operations into implemented vs pending (not yet built). */
export function partitionOperations(doc: OpenApiDocument): {
  implemented: OperationKey[];
  pending: OperationKey[];
} {
  const all = canonicalOperationKeys(doc);
  const implemented = all.filter((k) => IMPLEMENTED_PATHS.has(k));
  const pending = all.filter((k) => !IMPLEMENTED_PATHS.has(k));
  return { implemented, pending };
}
