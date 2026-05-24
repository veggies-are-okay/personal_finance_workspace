/**
 * Unit tests for the health-poll guard in src/backends.ts.
 *
 * The critical safety property: if the polled `/health` returns the UNRELATED
 * process's body `{"status":"healthy"}` (the thing squatting on :8000), the
 * harness must fail LOUDLY and immediately rather than treat it as a healthy
 * backend. These tests stub global `fetch` so no real backend is needed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForHealthy } from "../src/backends";

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waitForHealthy", () => {
  it('resolves when the backend returns our real {"status":"ok"} body', async () => {
    mockFetchOnce(200, { status: "ok" });
    await expect(
      waitForHealthy("x", "http://127.0.0.1:9", { attempts: 1, intervalMs: 1 }),
    ).resolves.toBeUndefined();
  });

  it('fails LOUDLY on the rogue {"status":"healthy"} body (wrong process)', async () => {
    mockFetchOnce(200, { status: "healthy" });
    await expect(
      waitForHealthy("x", "http://127.0.0.1:9", { attempts: 5, intervalMs: 1 }),
    ).rejects.toThrow(/healthy.*NOT our backend/s);
  });

  it("fails on any other unexpected 200 body", async () => {
    mockFetchOnce(200, { status: "weird" });
    await expect(
      waitForHealthy("x", "http://127.0.0.1:9", { attempts: 5, intervalMs: 1 }),
    ).rejects.toThrow(/unexpected health body/);
  });

  it("times out (bounded, no infinite wait) when never healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    await expect(
      waitForHealthy("x", "http://127.0.0.1:9", { attempts: 2, intervalMs: 1 }),
    ).rejects.toThrow(/did not become healthy/);
  });
});
