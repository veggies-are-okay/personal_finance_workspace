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
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// contracts/src -> repo root is two levels up.
const REPO_ROOT = resolve(HERE, "..", "..");

/** Read a positive-integer port from `name`, else fall back to `fallback`.
 *
 * Lets several parity runs execute **in parallel** on distinct ports (e.g.
 * parallel checklist subagents, each in its own worktree): set
 * `PARITY_PY_PORT` / `PARITY_TS_PORT` / `PARITY_PY_DOWN_PORT` /
 * `PARITY_TS_DOWN_PORT`. Unset → the original dedicated defaults, so existing
 * single-run behavior (and CI) is unchanged. */
function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Dedicated free ports — intentionally NOT 8000 (rogue process lives there). */
export const PY_PORT = envPort("PARITY_PY_PORT", 8765);
export const TS_PORT = envPort("PARITY_TS_PORT", 3765);

export const PY_BASE = `http://127.0.0.1:${PY_PORT}`;
export const TS_BASE = `http://127.0.0.1:${TS_PORT}`;

/** Separate ports for the short-lived DB-DOWN backend pair (DA-18 parity). */
export const PY_DOWN_PORT = envPort("PARITY_PY_DOWN_PORT", 8766);
export const TS_DOWN_PORT = envPort("PARITY_TS_DOWN_PORT", 3766);

export const PY_DOWN_BASE = `http://127.0.0.1:${PY_DOWN_PORT}`;
export const TS_DOWN_BASE = `http://127.0.0.1:${TS_DOWN_PORT}`;

/** An unreachable Postgres URL: both backends boot (DB-independent /health) but
 * any DB-backed request fails into the canonical 503 (DA-18). */
export const UNREACHABLE_DATABASE_URL =
  "postgresql://pf:pf@127.0.0.1:5499/does_not_exist";

/** The one and only acceptable health body. Anything else fails loudly. */
export const EXPECTED_HEALTH_BODY = { status: "ok" } as const;

/**
 * A SYNTHETIC base64 AES-256 key (32 bytes) forced on BOTH backends for the
 * parity run so the cross-backend token-decrypt test (DA-12) holds the key both
 * backends encrypt with. NOT a real APP_ENCRYPTION_KEY — test material only.
 */
export const PARITY_ENCRYPTION_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef",
).toString("base64");

export interface BackendHandle {
  name: string;
  base: string;
  proc: ChildProcess;
}

function backendDir(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

/** Directory the captured backend logs are streamed to (DA-14 log-scrub test). */
export const PARITY_LOG_DIR = resolve(REPO_ROOT, "contracts", ".parity-logs");
export const PY_LOG_FILE = resolve(PARITY_LOG_DIR, "python.log");
export const TS_LOG_FILE = resolve(PARITY_LOG_DIR, "nest.log");

/**
 * Stream a piped child's stdout+stderr to `logFile` (truncated first) so a test
 * worker — a SEPARATE process from this setup — can read the captured logs and
 * assert no token string ever reaches a log line (DA-14).
 */
function attachCapture(proc: ChildProcess, logFile: string): void {
  mkdirSync(PARITY_LOG_DIR, { recursive: true });
  writeFileSync(logFile, "");
  const append = (d: Buffer): void => appendFileSync(logFile, d.toString());
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
}

/** Spawn FastAPI via uvicorn on the given port (cwd = backend-python/). */
export function spawnPython(
  port: number = PY_PORT,
  extraEnv: NodeJS.ProcessEnv = {},
  capture = false,
): ChildProcess {
  return spawn(
    "uv",
    ["run", "uvicorn", "app.main:app", "--port", String(port)],
    {
      cwd: backendDir("backend-python"),
      stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
      // Own process group so we can kill the whole tree (uv -> uvicorn).
      detached: true,
      env: { ...process.env, ...extraEnv },
    },
  );
}

/** Spawn NestJS via `node dist/main.js` on the given port (cwd = backend-ts/). */
export function spawnNest(
  port: number = TS_PORT,
  extraEnv: NodeJS.ProcessEnv = {},
  capture = false,
): ChildProcess {
  return spawn("node", ["dist/main.js"], {
    cwd: backendDir("backend-ts"),
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    detached: true,
    env: { ...process.env, TS_API_PORT: String(port), ...extraEnv },
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
  // PLAID_FAKE=1 makes both backends use the network-free fake Plaid gateway
  // (P6.1) so the parity run is hermetic — no real Plaid call. A SYNTHETIC
  // APP_ENCRYPTION_KEY is forced for the run so the cross-backend token-decrypt
  // parity test holds the same key both backends encrypt with (DA-12).
  const plaidEnv = {
    PLAID_FAKE: "1",
    APP_ENCRYPTION_KEY: PARITY_ENCRYPTION_KEY,
  };
  // Capture stdout+stderr for the main pair so the DA-14 log-scrub parity test
  // can assert no token string ever reaches a log line.
  const pyProc = spawnPython(PY_PORT, plaidEnv, true);
  const nestProc = spawnNest(TS_PORT, plaidEnv, true);
  attachCapture(pyProc, PY_LOG_FILE);
  attachCapture(nestProc, TS_LOG_FILE);
  const python: BackendHandle = {
    name: "backend-python (FastAPI)",
    base: PY_BASE,
    proc: pyProc,
  };
  const nest: BackendHandle = {
    name: "backend-ts (NestJS)",
    base: TS_BASE,
    proc: nestProc,
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

/**
 * Boot a SECOND, short-lived pair of backends pointed at an UNREACHABLE database
 * (DA-18). Both still come up because `/health` is DB-independent (FastAPI's
 * engine connects lazily; NestJS uses a resilient DataSource factory), so the
 * caller can hit a DB-backed route on each and assert an identical canonical
 * 503. Returns handles for the caller to tear down.
 */
export async function startDbDownBackends(): Promise<{
  python: BackendHandle;
  nest: BackendHandle;
}> {
  const env = { DATABASE_URL: UNREACHABLE_DATABASE_URL };
  const python: BackendHandle = {
    name: "backend-python (DB-down)",
    base: PY_DOWN_BASE,
    proc: spawnPython(PY_DOWN_PORT, env),
  };
  const nest: BackendHandle = {
    name: "backend-ts (DB-down)",
    base: TS_DOWN_BASE,
    proc: spawnNest(TS_DOWN_PORT, env),
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
