import { defineConfig } from "vitest/config";

/**
 * Unit-only config: runs the pure normalizer tests WITHOUT booting the
 * backends (no globalSetup). Useful for fast local iteration on
 * `src/normalize.ts`. The full parity gate is `npm run test:parity`
 * (vitest.config.ts), which boots both backends.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.unit.test.ts"],
  },
});
