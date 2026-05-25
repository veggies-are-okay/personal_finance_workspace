/**
 * OpenAPI structural parity (canonical contract vs both live backends).
 *
 * FastAPI emits OpenAPI 3.1 and NestJS emits 3.0.x with different `$ref` names,
 * titles, and examples, so byte-equality is NOT expected. Instead we normalize
 * each document (see src/normalize.ts) and compare the structural essence of
 * each operation (path, method, success status, success schema).
 *
 * The canonical contract (openapi.canonical.json) is FROZEN and COMPLETE at
 * P2.2 (DA-25): it already declares every path the program will serve. The
 * backends implement those paths one `BE` branch at a time, so the strict
 * cross-backend check below is scoped to `IMPLEMENTED_PATHS` (see src/contract.ts) —
 * the single non-frozen knob a Stage-4 branch flips when it ships an endpoint.
 * Pending (not-yet-implemented) operations are reported as skipped, so this
 * gate cannot fail just because the canonical doc lists a not-yet-built route.
 */

import { inject, beforeAll, describe, expect, it } from "vitest";

import { getJson } from "../src/http";
import {
  normalizeApi,
  normalizeOperation,
  type NormalizedApi,
  type NormalizedOperation,
  type OpenApiDocument,
} from "../src/normalize";
import {
  IMPLEMENTED_PATHS,
  isIngestPath,
  loadCanonical,
  opKey,
  partitionOperations,
} from "../src/contract";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

let pyDoc: OpenApiDocument;
let tsDoc: OpenApiDocument;
let canonical: OpenApiDocument;

beforeAll(async () => {
  const [py, ts] = await Promise.all([
    getJson(`${pyBase}/openapi.json`),
    getJson(`${tsBase}/openapi.json`),
  ]);
  pyDoc = py.json as OpenApiDocument;
  tsDoc = ts.json as OpenApiDocument;
  canonical = loadCanonical();
});

describe("/health — OpenAPI structural parity", () => {
  it("both backends expose GET /health with a 200 JSON success response", () => {
    const py = normalizeOperation(pyDoc, "/health", "get");
    const ts = normalizeOperation(tsDoc, "/health", "get");

    expect(py, "FastAPI must declare GET /health").not.toBeNull();
    expect(ts, "NestJS must declare GET /health").not.toBeNull();

    expect(py!.method).toBe("get");
    expect(ts!.method).toBe("get");
    expect(py!.successStatus).toBe("200");
    expect(ts!.successStatus).toBe("200");
  });

  it("the /health success schema is structurally identical across backends", () => {
    const py = normalizeOperation(pyDoc, "/health", "get");
    const ts = normalizeOperation(tsDoc, "/health", "get");

    // Compare the two backends to EACH OTHER (drift guard).
    expect(py!.successSchema).toEqual(ts!.successSchema);

    // ...and confirm the agreed shape: object, required string `status`.
    expect(py!.successSchema).toEqual({
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", required: [], properties: {} } },
    });
  });

  it("both backends conform to the canonical contract for /health", () => {
    const canonicalOp = normalizeOperation(canonical, "/health", "get");
    const py = normalizeOperation(pyDoc, "/health", "get");
    const ts = normalizeOperation(tsDoc, "/health", "get");

    expect(
      canonicalOp,
      "canonical spec must define GET /health",
    ).not.toBeNull();
    expect(py).toEqual(canonicalOp);
    expect(ts).toEqual(canonicalOp);
  });
});

describe("canonical contract — structural diff vs both backends", () => {
  /**
   * Strict structural conformance, scoped to IMPLEMENTED endpoints only.
   * For each live operation: the canonical op exists, and BOTH backends match
   * it (and therefore each other). As Stage-4 branches add their path to
   * IMPLEMENTED_PATHS this loop auto-covers them with no edit to the frozen
   * OpenAPI. At P2.2 the only implemented operation is GET /health.
   */
  it("every IMPLEMENTED canonical operation is matched by both backends", () => {
    const canonicalApi: NormalizedApi = normalizeApi(canonical);
    const pyApi: NormalizedApi = normalizeApi(pyDoc);
    const tsApi: NormalizedApi = normalizeApi(tsDoc);

    const implemented = [...IMPLEMENTED_PATHS];
    expect(
      implemented.length,
      "at least /health must be implemented",
    ).toBeGreaterThan(0);

    for (const path of Object.keys(canonicalApi)) {
      for (const method of Object.keys(canonicalApi[path])) {
        if (!IMPLEMENTED_PATHS.has(opKey(method, path))) continue; // pending
        const expected: NormalizedOperation = canonicalApi[path][method];
        expect(
          pyApi[path]?.[method],
          `FastAPI missing/diverged on ${method.toUpperCase()} ${path}`,
        ).toEqual(expected);
        expect(
          tsApi[path]?.[method],
          `NestJS missing/diverged on ${method.toUpperCase()} ${path}`,
        ).toEqual(expected);
      }
    }
  });

  it("Python exposes no paths beyond canonical EXCEPT the /ingest carve-out (P8.1)", () => {
    // Ingestion is Python-owned and OUT of the read-parity contract (like
    // Alembic owning migrations): /api/v1/ingest/* lives in FastAPI only and is
    // NOT in the canonical doc. This guard asserts the carve-out is the ONLY
    // allowed divergence — every other Python path MUST exist in canonical, so
    // genuine drift (an accidental extra endpoint) still fails the gate. See
    // .claude/rules/backend-parity.md.
    const canonicalApi: NormalizedApi = normalizeApi(canonical);
    const pyApi: NormalizedApi = normalizeApi(pyDoc);

    const unexpected = Object.keys(pyApi)
      .filter((path) => !isIngestPath(path)) // ignore the Python-only ingest surface
      .filter((path) => canonicalApi[path] === undefined);

    expect(
      unexpected,
      `FastAPI exposes path(s) absent from the canonical contract (and not the ` +
        `/ingest carve-out): ${unexpected.join(", ")}`,
    ).toEqual([]);

    // And NestJS must expose NONE of the ingest paths (Python-only surface).
    const tsApi: NormalizedApi = normalizeApi(tsDoc);
    const tsIngest = Object.keys(tsApi).filter((path) => isIngestPath(path));
    expect(
      tsIngest,
      `NestJS must NOT implement the Python-only ingest surface: ${tsIngest.join(", ")}`,
    ).toEqual([]);
  });

  it("the canonical contract declares the full P2.2 path inventory (frozen)", () => {
    // Guards DA-25: the canonical doc must contain ALL view + source +
    // connections paths up front so Stage-4 branches never edit it. This
    // asserts the inventory is complete; it does NOT require the backends to
    // implement them yet.
    const { implemented, pending } = partitionOperations(canonical);
    const all = [...implemented, ...pending];

    const expectedInventory = [
      opKey("GET", "/health"),
      opKey("GET", "/api/v1/transactions"),
      opKey("GET", "/api/v1/budget"),
      opKey("GET", "/api/v1/networth"),
      opKey("GET", "/api/v1/investments"),
      opKey("GET", "/api/v1/debt"),
      opKey("GET", "/api/v1/goals"),
      opKey("GET", "/api/v1/sources/transactions"),
      opKey("GET", "/api/v1/sources/income"),
      opKey("GET", "/api/v1/sources/holdings"),
      opKey("GET", "/api/v1/sources/loans"),
      opKey("GET", "/api/v1/sources/listings"),
      opKey("POST", "/api/v1/connections/link-token"),
      opKey("POST", "/api/v1/connections/exchange"),
      opKey("GET", "/api/v1/connections"),
      opKey("POST", "/api/v1/connections/webhook"),
    ].sort();

    expect(all.sort()).toEqual(expectedInventory);
  });

  // Pending operations are surfaced (not silently dropped) as skipped todos so
  // the gate output shows exactly which contract paths still await a backend.
  const { pending } = partitionOperations(loadCanonical());
  for (const key of pending) {
    it.skip(`PENDING backend impl + parity: ${key}`, () => {
      // Filled in by the Stage-4 BE branch that implements this endpoint:
      // 1. implement in backend-python + backend-ts,
      // 2. add `${key}` to IMPLEMENTED_PATHS in src/contract.ts,
      // 3. the strict structural check above then covers it automatically.
    });
  }
});
