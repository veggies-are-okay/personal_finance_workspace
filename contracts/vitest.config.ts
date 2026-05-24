import { defineConfig } from "vitest/config";

/**
 * Parity harness test config.
 *
 * - `globalSetup` boots BOTH backends once before any test and tears them down
 *   after (self-contained `npm run test:parity`).
 * - Tests run single-fork / non-parallel: there is exactly one pair of live
 *   backends, and parity tests are I/O-bound HTTP calls, so isolation buys
 *   nothing and a single worker keeps the shared base URLs simple.
 * - Generous hook timeout: booting uvicorn + node and polling /health can take
 *   a few seconds on a cold start.
 */
export default defineConfig({
  test: {
    globalSetup: ["./src/global-setup.ts"],
    include: ["test/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ["default"],
  },
});
