/**
 * OpenAPI structural normalizer.
 *
 * FastAPI emits OpenAPI 3.1 and NestJS emits 3.0.x with different `$ref`
 * component names, titles, examples, descriptions, and ordering — so the two
 * documents are NEVER byte-identical. This module reduces an arbitrary OpenAPI
 * document down to a small, comparable, version-agnostic shape so the parity
 * harness can assert two backends (and the canonical contract) describe the
 * SAME API.
 *
 * The normalizer is intentionally generic: it walks every path + method in the
 * document, so when a new endpoint is added to both backends + the canonical
 * spec it is automatically covered by the same structural parity check. No
 * per-endpoint code is required.
 */

/** A JSON Schema fragment as it appears in an OpenAPI document. */
export interface OpenApiSchema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  $ref?: string;
  // Pass-through bag for anything else (titles, examples, etc.) — ignored by
  // normalization but typed loosely so we can read it without `any`.
  [key: string]: unknown;
}

export interface OpenApiResponse {
  content?: Record<string, { schema?: OpenApiSchema }>;
}

export interface OpenApiOperation {
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiDocument {
  openapi?: string;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
  [key: string]: unknown;
}

/** Canonical, comparable shape for a single JSON-schema node. */
export interface NormalizedSchema {
  type: string;
  required: string[];
  properties: Record<string, NormalizedSchema>;
  items?: NormalizedSchema;
}

/** Canonical, comparable shape for one success response of one operation. */
export interface NormalizedOperation {
  /** lower-cased HTTP method, e.g. "get" */
  method: string;
  /** the success status code as a string, e.g. "200" */
  successStatus: string;
  /** structural schema of the success JSON body, or null if none declared */
  successSchema: NormalizedSchema | null;
}

/** path -> method -> normalized operation. Stable, comparable across backends. */
export type NormalizedApi = Record<string, Record<string, NormalizedOperation>>;

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
]);

const REF_PREFIX = "#/components/schemas/";

/**
 * Result of resolving a (possibly `$ref`) schema: the concrete schema node plus
 * the accumulated set of component names visited en route. Callers MUST thread
 * `seen` into any further recursion so cycles are caught across nested props.
 */
interface Resolved {
  schema: OpenApiSchema;
  seen: Set<string>;
}

/**
 * Resolve a `$ref` (`#/components/schemas/Foo`) against the document's
 * component schemas. Guards against self-referential cycles via a visited set
 * keyed on the ref's component name (the name itself is structural metadata
 * only — different backends' `$ref` names, HealthResponse vs HealthResponseDto,
 * never affect the normalized result). Returns the accumulated `seen` set so
 * the caller propagates it into child recursion.
 */
function resolveRef(
  schema: OpenApiSchema,
  doc: OpenApiDocument,
  seen: Set<string>,
): Resolved | null {
  if (!schema.$ref) return { schema, seen };
  if (!schema.$ref.startsWith(REF_PREFIX)) return null;
  const name = schema.$ref.slice(REF_PREFIX.length);
  if (seen.has(name)) return null; // cycle guard
  const target = doc.components?.schemas?.[name];
  if (!target) return null;
  const nextSeen = new Set(seen).add(name);
  return resolveRef(target, doc, nextSeen);
}

/** OpenAPI 3.1 allows `type: ["string", "null"]`; collapse to a stable string. */
function normalizeType(type: OpenApiSchema["type"]): string {
  if (Array.isArray(type)) {
    // Drop "null" so a nullable string and a string compare equal at this
    // structural level; sort for stability.
    const kept = type.filter((t) => t !== "null").sort();
    return kept.length === 1 ? kept[0] : kept.join("|") || "unknown";
  }
  return type ?? "unknown";
}

/**
 * Reduce a schema node to its structural essence: type, sorted required list,
 * and recursively-normalized properties/items. Strips titles, examples,
 * descriptions, formats, `$ref` names, and key ordering.
 */
export function normalizeSchema(
  schema: OpenApiSchema | undefined,
  doc: OpenApiDocument,
  seen: Set<string> = new Set(),
): NormalizedSchema | null {
  if (!schema) return null;
  const resolved = resolveRef(schema, doc, seen);
  if (!resolved) return null;
  const node = resolved.schema;
  const nextSeen = resolved.seen;

  const normalized: NormalizedSchema = {
    type: normalizeType(node.type),
    required: [...(node.required ?? [])].sort(),
    properties: {},
  };

  if (node.properties) {
    for (const key of Object.keys(node.properties).sort()) {
      const child = normalizeSchema(node.properties[key], doc, nextSeen);
      if (child) normalized.properties[key] = child;
    }
  }

  if (node.items) {
    const items = normalizeSchema(node.items, doc, nextSeen);
    if (items) normalized.items = items;
  }

  return normalized;
}

/** Pick the success (2xx) status code for an operation; lowest wins. */
function pickSuccessStatus(op: OpenApiOperation): string | null {
  const codes = Object.keys(op.responses ?? {}).filter((c) =>
    /^2\d\d$/.test(c),
  );
  if (codes.length === 0) return null;
  return codes.sort()[0];
}

/** Extract the application/json schema for a given response status. */
function jsonSchemaFor(
  op: OpenApiOperation,
  status: string,
): OpenApiSchema | undefined {
  return op.responses?.[status]?.content?.["application/json"]?.schema;
}

/**
 * Normalize a whole OpenAPI document into a comparable {path: {method: op}}
 * map. Only paths/methods with a declared JSON success response are included,
 * so the canonical contract and both backends can be compared 1:1.
 */
export function normalizeApi(doc: OpenApiDocument): NormalizedApi {
  const out: NormalizedApi = {};
  const paths = doc.paths ?? {};

  for (const path of Object.keys(paths)) {
    const methods = paths[path];
    for (const method of Object.keys(methods)) {
      const lower = method.toLowerCase();
      if (!HTTP_METHODS.has(lower)) continue;
      const op = methods[method];
      const successStatus = pickSuccessStatus(op);
      if (!successStatus) continue;
      const successSchema = normalizeSchema(
        jsonSchemaFor(op, successStatus),
        doc,
      );

      out[path] ??= {};
      out[path][lower] = { method: lower, successStatus, successSchema };
    }
  }

  return out;
}

/**
 * Normalize a single operation by path + method (convenience for targeted
 * assertions like the `/health` parity test).
 */
export function normalizeOperation(
  doc: OpenApiDocument,
  path: string,
  method: string,
): NormalizedOperation | null {
  return normalizeApi(doc)[path]?.[method.toLowerCase()] ?? null;
}
