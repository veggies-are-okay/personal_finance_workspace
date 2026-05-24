/**
 * Unit tests for the OpenAPI structural normalizer.
 *
 * These run WITHOUT booting the backends (pure functions over synthetic OpenAPI
 * fragments). They pin the normalizer's behavior so the end-to-end parity
 * assertions stay trustworthy: $ref resolution, version/title/example
 * stripping, 3.1 `["string","null"]` collapsing, and stable ordering.
 */

import { describe, expect, it } from "vitest";

import {
  normalizeApi,
  normalizeOperation,
  normalizeSchema,
  type OpenApiDocument,
} from "../src/normalize";

// Synthetic FastAPI-style (3.1) doc with a $ref + titles.
const fastapiLike: OpenApiDocument = {
  openapi: "3.1.0",
  paths: {
    "/health": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthResponse: {
        title: "HealthResponse",
        type: "object",
        required: ["status"],
        properties: { status: { type: "string", title: "Status" } },
      },
    },
  },
};

// Synthetic NestJS-style (3.0) doc: DIFFERENT $ref name + example, same shape.
const nestLike: OpenApiDocument = {
  openapi: "3.0.0",
  paths: {
    "/health": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponseDto" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthResponseDto: {
        type: "object",
        required: ["status"],
        properties: { status: { type: "string", example: "ok" } },
      },
    },
  },
};

describe("normalizeSchema", () => {
  it("resolves $ref and strips titles/examples", () => {
    const result = normalizeSchema(
      { $ref: "#/components/schemas/HealthResponse" },
      fastapiLike,
    );
    expect(result).toEqual({
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", required: [], properties: {} } },
    });
  });

  it('collapses OpenAPI 3.1 nullable union ["string","null"] to "string"', () => {
    const result = normalizeSchema(
      { type: ["string", "null"] } as unknown as Parameters<
        typeof normalizeSchema
      >[0],
      { paths: {} },
    );
    expect(result?.type).toBe("string");
  });

  it("sorts required and property keys for stable comparison", () => {
    const doc: OpenApiDocument = { paths: {} };
    const result = normalizeSchema(
      {
        type: "object",
        required: ["b", "a"],
        properties: { z: { type: "string" }, a: { type: "string" } },
      },
      doc,
    );
    expect(result?.required).toEqual(["a", "b"]);
    expect(Object.keys(result!.properties)).toEqual(["a", "z"]);
  });

  it("returns null for an unresolvable $ref (no crash)", () => {
    expect(
      normalizeSchema({ $ref: "#/components/schemas/Missing" }, { paths: {} }),
    ).toBeNull();
  });

  it("guards against self-referential cycles", () => {
    const cyclic: OpenApiDocument = {
      paths: {},
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    };
    const result = normalizeSchema(
      { $ref: "#/components/schemas/Node" },
      cyclic,
    );
    expect(result?.type).toBe("object");
    // `next` resolves to null at the cycle and is dropped.
    expect(result?.properties.next).toBeUndefined();
  });

  it("normalizes array item schemas recursively", () => {
    const result = normalizeSchema(
      { type: "array", items: { type: "string" } },
      { paths: {} },
    );
    expect(result?.type).toBe("array");
    expect(result?.items).toEqual({
      type: "string",
      required: [],
      properties: {},
    });
  });
});

describe("normalizeOperation / normalizeApi", () => {
  it("extracts GET /health 200 success schema", () => {
    const op = normalizeOperation(fastapiLike, "/health", "get");
    expect(op).toEqual({
      method: "get",
      successStatus: "200",
      successSchema: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", required: [], properties: {} },
        },
      },
    });
  });

  it("produces equal normalized operations for differently-named $refs", () => {
    const py = normalizeOperation(fastapiLike, "/health", "get");
    const ts = normalizeOperation(nestLike, "/health", "get");
    expect(py).toEqual(ts);
  });

  it("returns null for an absent operation", () => {
    expect(normalizeOperation(fastapiLike, "/nope", "get")).toBeNull();
    expect(normalizeOperation(fastapiLike, "/health", "post")).toBeNull();
  });

  it("ignores non-HTTP-method keys and operations without a 2xx response", () => {
    const doc: OpenApiDocument = {
      paths: {
        "/x": {
          // not a method:
          parameters: {} as never,
          // no 2xx:
          get: { responses: { "404": {} } },
        },
      },
    };
    const api = normalizeApi(doc);
    expect(api["/x"]).toBeUndefined();
  });

  it("records a null success schema when no JSON content is declared", () => {
    const doc: OpenApiDocument = {
      paths: { "/ping": { get: { responses: { "204": {} } } } },
    };
    const op = normalizeApi(doc)["/ping"].get;
    expect(op.successStatus).toBe("204");
    expect(op.successSchema).toBeNull();
  });
});
