/**
 * Unit tests for the canonical-contract loader + implemented-paths allowlist.
 *
 * Run WITHOUT booting the backends (pure reads of openapi.canonical.json). They
 * pin the invariants the parity gate relies on:
 *   - the canonical doc loads and declares the COMPLETE frozen path inventory
 *     (DA-25): all view + source + connections operations,
 *   - the implemented allowlist grows ONLY by appending live endpoints (here
 *     /health + the P4.1 transactions + P4.2 budget endpoints) — the canonical
 *     doc stays frozen,
 *   - the partition (implemented vs pending) is consistent with the inventory,
 *   - Appendix A wire conventions are baked into the reusable components
 *     (money = string w/ 2dp pattern; percentage = number 0-100; the enum
 *     registry; the Error envelope; the Pagination envelope).
 */

import { describe, expect, it } from "vitest";

import {
  IMPLEMENTED_PATHS,
  INGEST_PATH_PREFIX,
  canonicalOperationKeys,
  isIngestPath,
  loadCanonical,
  opKey,
  partitionOperations,
} from "../src/contract";

const EXPECTED_INVENTORY = [
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

describe("canonical contract — frozen path inventory (P2.2 / DA-25)", () => {
  it("loads and declares exactly the complete inventory", () => {
    const doc = loadCanonical();
    expect(canonicalOperationKeys(doc)).toEqual(EXPECTED_INVENTORY);
  });

  const IMPLEMENTED_NOW = [
    opKey("GET", "/health"),
    opKey("GET", "/api/v1/transactions"),
    opKey("GET", "/api/v1/budget"),
    opKey("GET", "/api/v1/networth"),
    opKey("GET", "/api/v1/investments"),
    opKey("GET", "/api/v1/debt"),
    opKey("GET", "/api/v1/goals"),
    // P6.1 connections API (link/exchange/list + JWT-verified webhook).
    opKey("POST", "/api/v1/connections/link-token"),
    opKey("POST", "/api/v1/connections/exchange"),
    opKey("GET", "/api/v1/connections"),
    opKey("POST", "/api/v1/connections/webhook"),
  ].sort();

  it("implements /health, the P4 view endpoints, and the P6.1 connections API", () => {
    expect([...IMPLEMENTED_PATHS].sort()).toEqual(IMPLEMENTED_NOW);
  });

  it("partitions implemented vs pending consistently", () => {
    const doc = loadCanonical();
    const { implemented, pending } = partitionOperations(doc);
    expect(implemented.sort()).toEqual(IMPLEMENTED_NOW);
    // The not-yet-built source endpoints remain pending.
    expect(pending).toContain(opKey("GET", "/api/v1/sources/transactions"));
    expect(pending).not.toContain(opKey("GET", "/api/v1/transactions"));
    expect(pending).not.toContain(opKey("POST", "/api/v1/connections/webhook"));
    expect(pending).not.toContain(opKey("GET", "/api/v1/connections"));
    expect([...implemented, ...pending].sort()).toEqual(EXPECTED_INVENTORY);
  });
});

describe("ingestion carve-out (P8.1) — Python-owned, out of read parity", () => {
  it("identifies /api/v1/ingest/* as the ingest carve-out", () => {
    expect(isIngestPath(INGEST_PATH_PREFIX)).toBe(true);
    expect(isIngestPath(`${INGEST_PATH_PREFIX}/transactions`)).toBe(true);
    expect(isIngestPath(`${INGEST_PATH_PREFIX}/{source}`)).toBe(true);
  });

  it("does NOT match read-API or look-alike paths", () => {
    expect(isIngestPath("/api/v1/transactions")).toBe(false);
    expect(isIngestPath("/api/v1/connections")).toBe(false);
    // a path that merely starts with the same letters but is a different segment
    expect(isIngestPath("/api/v1/ingestion-status")).toBe(false);
    expect(isIngestPath("/health")).toBe(false);
  });

  it("the canonical contract declares NO ingest path (Python-only surface)", () => {
    // The /ingest endpoints must never enter the canonical read contract.
    const keys = canonicalOperationKeys(loadCanonical());
    expect(keys.some((k) => k.includes(INGEST_PATH_PREFIX))).toBe(false);
  });
});

describe("Appendix A conventions are baked into reusable components", () => {
  const doc = loadCanonical() as {
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  const schemas = doc.components.schemas;

  it("Money is a 2dp decimal STRING (never a number)", () => {
    expect(schemas.Money.type).toBe("string");
    expect(schemas.Money.pattern).toBe("^-?\\d+\\.\\d{2}$");
  });

  it("Percentage is a JSON number on a 0-100 scale", () => {
    expect(schemas.Percentage.type).toBe("number");
    expect(schemas.Percentage.minimum).toBe(0);
    expect(schemas.Percentage.maximum).toBe(100);
  });

  it("Date / DateTime use the right formats", () => {
    expect(schemas.Date).toMatchObject({ type: "string", format: "date" });
    expect(schemas.DateTime).toMatchObject({
      type: "string",
      format: "date-time",
    });
  });

  it("enum registry has the exact lower_snake values (DA-5)", () => {
    expect(schemas.Bucket.enum).toEqual(["needs", "wants", "savings"]);
    expect(schemas.Source.enum).toEqual([
      "transactions",
      "income",
      "holdings",
      "loans",
      "listings",
    ]);
    expect(schemas.SourceMode.enum).toEqual(["local", "api"]);
    expect(schemas.ItemStatus.enum).toEqual([
      "connected",
      "needs_reauth",
      "error",
      "disconnected",
      "not_connected",
    ]);
    expect(schemas.LoanPriority.enum).toEqual([
      "pay_first",
      "then",
      "minimums",
    ]);
    expect(schemas.PayoffStrategy.enum).toEqual(["avalanche", "minimums"]);
  });

  it("the Error envelope is the canonical shape (DA-1)", () => {
    const err = schemas.Error as {
      properties: { error: Record<string, unknown> };
    };
    const inner = err.properties.error as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(inner.required).toEqual(["code", "message", "details"]);
    expect(Object.keys(inner.properties).sort()).toEqual([
      "code",
      "details",
      "message",
    ]);
  });

  it("the Pagination envelope has limit/offset/total (DA-4)", () => {
    const pag = schemas.Pagination as { required: string[] };
    expect(pag.required.sort()).toEqual(["limit", "offset", "total"]);
  });
});
