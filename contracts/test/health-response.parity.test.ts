/**
 * Response parity for GET /health.
 *
 * Both backends are booted by the global setup. We hit `/health` on each and
 * assert: identical 200 status, JSON content-type on both, and identical JSON
 * bodies. Crucially we compare the two LIVE responses to EACH OTHER (not just
 * to a literal), so any future drift between the backends fails this test.
 */

import { inject, describe, expect, it } from "vitest";

import { getJson, isJsonContentType } from "../src/http";
import { EXPECTED_HEALTH_BODY } from "../src/backends";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

describe("GET /health — response parity", () => {
  it("both backends return 200 with JSON content-type and identical bodies", async () => {
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}/health`),
      getJson(`${tsBase}/health`),
    ]);

    // Status parity (and both are 200).
    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.status).toBe(ts.status);

    // JSON content-type on BOTH.
    expect(isJsonContentType(py.contentType)).toBe(true);
    expect(isJsonContentType(ts.contentType)).toBe(true);

    // Bodies equal each other (drift guard) AND match the canonical body.
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual(EXPECTED_HEALTH_BODY);
    expect(ts.json).toEqual(EXPECTED_HEALTH_BODY);
  });
});
