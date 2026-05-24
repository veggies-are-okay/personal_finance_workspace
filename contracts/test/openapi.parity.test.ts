/**
 * OpenAPI structural parity for /health.
 *
 * FastAPI emits OpenAPI 3.1 and NestJS emits 3.0.x with different `$ref` names,
 * titles, and examples, so byte-equality is NOT expected. Instead we normalize
 * each document (see src/normalize.ts) and assert the `/health` GET operation
 * is structurally equivalent across BOTH backends and the canonical contract:
 * same path, same method (GET), same success status (200), and an equivalent
 * success schema (object with required string `status`).
 *
 * The normalizer walks EVERY path/method, so adding a new endpoint to both
 * backends + openapi.canonical.json is auto-covered by the same structural
 * comparison below.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { inject, beforeAll, describe, expect, it } from "vitest";

import { getJson } from "../src/http";
import {
  normalizeApi,
  normalizeOperation,
  type NormalizedApi,
  type OpenApiDocument,
} from "../src/normalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL_PATH = resolve(HERE, "..", "openapi.canonical.json");

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
  canonical = JSON.parse(
    readFileSync(CANONICAL_PATH, "utf8"),
  ) as OpenApiDocument;
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

  it("every operation in the canonical contract is matched by both backends", () => {
    // Future-proofing: as endpoints are added to openapi.canonical.json + both
    // backends, this loop auto-covers them with the same structural check.
    const canonicalApi: NormalizedApi = normalizeApi(canonical);
    const pyApi: NormalizedApi = normalizeApi(pyDoc);
    const tsApi: NormalizedApi = normalizeApi(tsDoc);

    for (const path of Object.keys(canonicalApi)) {
      for (const method of Object.keys(canonicalApi[path])) {
        const expected = canonicalApi[path][method];
        expect(
          pyApi[path]?.[method],
          `FastAPI missing ${method} ${path}`,
        ).toEqual(expected);
        expect(
          tsApi[path]?.[method],
          `NestJS missing ${method} ${path}`,
        ).toEqual(expected);
      }
    }
  });
});
