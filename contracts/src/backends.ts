/**
 * Backend orchestration for the parity harness.
 *
 * Boots BOTH backends on dedicated FREE ports, polls each `/health` until it
 * answers our REAL body `{"status":"ok"}` (guarding against the unrelated
 * process on :8000 that returns `{"status":"healthy"}`), and exposes a clean
 * teardown that kills each child process TREE — even on failure.
 *
 * Ports are deliberately NOT 8000 (occupied on this machine by an unrelated
 * process). See contracts/README.md.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// contracts/src -> repo root is two levels up.
const REPO_ROOT = resolve(HERE, "..", "..");

/** Dedicated free ports — intentionally NOT 8000 (rogue process lives there). */
export const PY_PORT = 8765;
export const TS_PORT = 3765;

export const PY_BASE = `http://127.0.0.1:${PY_PORT}`;
export const TS_BASE = `http://127.0.0.1:${TS_PORT}`;

/** The one and only acceptable health body. Anything else fails loudly. */
export const EXPECTED_HEALTH_BODY = { status: "ok" } as const;

export interface BackendHandle {
  name: string;
  base: string;
  proc: ChildProcess;
}

function backendDir(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

/** Spawn FastAPI via uvicorn on PY_PORT (cwd = backend-python/). */
export function spawnPython(): ChildProcess {
  return spawn(
    "uv",
    ["run", "uvicorn", "app.main:app", "--port", String(PY_PORT)],
    {
      cwd: backendDir("backend-python"),
      stdio: "ignore",
      // Own process group so we can kill the whole tree (uv -> uvicorn).
      detached: true,
      env: { ...process.env },
    },
  );
}

/** Spawn NestJS via `node dist/main.js` with TS_API_PORT (cwd = backend-ts/). */
export function spawnNest(): ChildProcess {
  return spawn("node", ["dist/main.js"], {
    cwd: backendDir("backend-ts"),
    stdio: "ignore",
    detached: true,
    env: { ...process.env, TS_API_PORT: String(TS_PORT) },
  });
}

/** Kill a child process TREE (negative PID targets the process group). */
export function killTree(proc: ChildProcess | undefined): void {
  if (!proc || proc.pid === undefined || proc.killed) return;
  try {
    // detached:true gave the child its own group; -pid signals the group.
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // Group may already be gone; fall back to the direct pid.
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Poll `${base}/health` until it returns 200 with our REAL body
 * `{"status":"ok"}`. Bounded retries (no infinite wait). Throws — loudly — if
 * the deadline passes OR if we get the rogue `{"status":"healthy"}` body (which
 * means we hit the wrong process / wrong port).
 */
export async function waitForHealthy(
  name: string,
  base: string,
  {
    attempts = 60,
    intervalMs = 500,
  }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.status === 200) {
        const body = (await res.json()) as Record<string, unknown>;
        if (body.status === "ok") return; // healthy and OURS
        if (body.status === "healthy") {
          throw new Error(
            `${name} at ${base} returned {"status":"healthy"} — that is the ` +
              `unrelated process (likely :8000), NOT our backend. Aborting.`,
          );
        }
        throw new Error(
          `${name} at ${base} returned unexpected health body: ${JSON.stringify(body)}`,
        );
      }
      lastErr = `status ${res.status}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A hard mismatch (wrong process) must fail immediately, not retry.
      if (msg.includes("healthy") || msg.includes("unexpected health body")) {
        throw err;
      }
      lastErr = msg;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `${name} at ${base} did not become healthy within ` +
      `${attempts * intervalMs}ms (last: ${lastErr}).`,
  );
}

/**
 * Boot both backends and wait until BOTH report our real health body.
 * Returns handles; on any failure, tears down whatever was started.
 */
export async function startBackends(): Promise<{
  python: BackendHandle;
  nest: BackendHandle;
}> {
  const python: BackendHandle = {
    name: "backend-python (FastAPI)",
    base: PY_BASE,
    proc: spawnPython(),
  };
  const nest: BackendHandle = {
    name: "backend-ts (NestJS)",
    base: TS_BASE,
    proc: spawnNest(),
  };

  try {
    await Promise.all([
      waitForHealthy(python.name, python.base),
      waitForHealthy(nest.name, nest.base),
    ]);
  } catch (err) {
    killTree(python.proc);
    killTree(nest.proc);
    throw err;
  }

  return { python, nest };
}
