/**
 * Vitest global setup for the parity harness.
 *
 * Makes `npm run test:parity` fully self-contained: it boots BOTH backends,
 * waits until each returns our real `{"status":"ok"}` health body, hands the
 * base URLs to the tests, and tears the processes down afterwards — even if a
 * test throws. Vitest calls the returned function as teardown.
 *
 * The setup runs in its own process (separate from the test workers), so base
 * URLs are passed to tests via `project.provide(...)` and read with
 * `inject(...)` in the test files.
 */

import type { TestProject } from "vitest/node";

import {
  PY_BASE,
  TS_BASE,
  startBackends,
  killTree,
  type BackendHandle,
} from "./backends";

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  // Ensure both backends are buildable/runnable before we try to boot them.
  // (uv sync + nest build are handled by the `pretest:parity` npm script so
  // this setup stays fast; see package.json.)
  let python: BackendHandle;
  let nest: BackendHandle;

  const started = await startBackends();
  python = started.python;
  nest = started.nest;

  // Hand the live base URLs to the test workers.
  project.provide("pyBase", PY_BASE);
  project.provide("tsBase", TS_BASE);

  // Teardown: kill both trees. Wrapped so one failure can't leak the other.
  return async function teardown(): Promise<void> {
    killTree(python.proc);
    killTree(nest.proc);
  };
}

// Type augmentation so `inject('pyBase')` / `inject('tsBase')` are typed.
declare module "vitest" {
  export interface ProvidedContext {
    pyBase: string;
    tsBase: string;
  }
}
