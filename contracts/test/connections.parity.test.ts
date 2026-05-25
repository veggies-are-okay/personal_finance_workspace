/**
 * Value + security parity for the P6.1 connections API.
 *
 * Both backends are booted by the global setup with PLAID_FAKE=1 (network-free
 * fake Plaid gateway) and a SYNTHETIC shared APP_ENCRYPTION_KEY, reading the SAME
 * Postgres. We hit each backend with the SAME request and assert the two live
 * responses equal EACH OTHER (drift guard) and satisfy Appendix A, plus the
 * security invariants the P6.1 checklist names:
 *
 *  - link-token: identical {link_token, expiration}; expiration is ISO-8601 ...Z.
 *  - exchange: identical {item_id, status}; access_token NEVER returned.
 *  - NO plaintext token at rest: the BYTEA column contains no token substring.
 *  - CROSS-BACKEND decrypt (DA-12): a token written by FastAPI decrypts with the
 *    TS node:crypto AES-GCM, and a token written by NestJS decrypts with the
 *    Python cryptography.AESGCM (proven via a `uv run` subprocess).
 *  - GET /connections: identical {items, sources} snapshot.
 *  - webhook: forged + unsigned JWT -> identical canonical 401; a correctly
 *    signed (synthetic-key) webhook -> identical {status:"accepted"}.
 *  - log-scrub (DA-14): no token string appears in either backend's logs.
 *  - redirect allowlist: a non-allowlisted redirect_uri is rejected (no open
 *    redirect), identically across backends.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SignJWT, importPKCS8 } from "jose";
import { inject, afterAll, beforeAll, describe, expect, it } from "vitest";

import { getJson } from "../src/http";
import {
  PARITY_ENCRYPTION_KEY,
  PY_LOG_FILE,
  TS_LOG_FILE,
} from "../src/backends";
import {
  FAKE_ITEM_ID,
  cleanupConnectionsFixture,
  decryptTokenNode,
  readPlaidItemToken,
} from "../src/db";

const pyBase = inject("pyBase");
const tsBase = inject("tsBase");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// A SYNTHETIC ES256 private key (PKCS8 PEM) matching the FAKE_JWK both backends
// serve. TEST MATERIAL ONLY — never a real Plaid signing key.
const FAKE_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgdSTCnHzZoWuAVZc+
Q22GNs8SWxkaxh7bMTsAuuxYOJWhRANCAATNxapB2xcQ7+sRT7VJFTPsbbGWAc44
oQ+st005sv3htxfN/Ck6B/Ap/nlahj+vzQwk0rj3jGvEvSO1+iHcY70+
-----END PRIVATE KEY-----`;
const KID = "pf-fake-kid-1";

// The synthetic access token the fake gateway returns (never stored plaintext).
const FAKE_ACCESS_TOKEN = "access-fake-do-not-store-plaintext";

const LINK = "/api/v1/connections/link-token";
const EXCHANGE = "/api/v1/connections/exchange";
const CONNECTIONS = "/api/v1/connections";
const WEBHOOK = "/api/v1/connections/webhook";
const OAUTH = "/api/v1/connections/oauth";

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

async function signWebhook(
  rawBody: string,
  opts: { iat?: number } = {},
): Promise<string> {
  const key = await importPKCS8(FAKE_PRIVATE_PEM, "ES256");
  const hash = createHash("sha256").update(rawBody).digest("hex");
  return new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuedAt(opts.iat ?? Math.floor(Date.now() / 1000))
    .sign(key);
}

/** Decrypt a token blob with the Python backend's cryptography.AESGCM. */
function decryptTokenPython(blob: Buffer, base64Key: string): string {
  const script = [
    "import base64,sys",
    "sys.path.insert(0, 'app')",
    "from app.connections.crypto import decrypt_token",
    "blob=base64.b64decode(sys.argv[1]); key=sys.argv[2]",
    "print(decrypt_token(blob, key), end='')",
  ].join("\n");
  return execFileSync(
    "uv",
    ["run", "python", "-c", script, blob.toString("base64"), base64Key],
    { cwd: resolve(REPO_ROOT, "backend-python"), encoding: "utf8" },
  );
}

beforeAll(async () => {
  await cleanupConnectionsFixture();
});

afterAll(async () => {
  await cleanupConnectionsFixture();
});

describe("connections — link-token + exchange parity (P6.1)", () => {
  it("POST /link-token returns an identical shape; expiration is ISO-Z", async () => {
    const [py, ts] = await Promise.all([
      postJson(`${pyBase}${LINK}`, { products: ["transactions"] }),
      postJson(`${tsBase}${LINK}`, { products: ["transactions"] }),
    ]);
    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);

    const body = py.json as { link_token: string; expiration: string };
    expect(typeof body.link_token).toBe("string");
    expect(body.expiration).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("POST /exchange returns identical {item_id,status}; no token in the body", async () => {
    const [py, ts] = await Promise.all([
      postJson(`${pyBase}${EXCHANGE}`, { public_token: "public-fake" }),
      postJson(`${tsBase}${EXCHANGE}`, { public_token: "public-fake" }),
    ]);
    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({ item_id: FAKE_ITEM_ID, status: "connected" });
    // The access_token is NEVER present in the response (any backend).
    expect(py.text).not.toContain(FAKE_ACCESS_TOKEN);
    expect(ts.text).not.toContain(FAKE_ACCESS_TOKEN);
  });

  it("invalid exchange body -> identical canonical 422 (DA-1)", async () => {
    const [py, ts] = await Promise.all([
      postJson(`${pyBase}${EXCHANGE}`, {}),
      postJson(`${tsBase}${EXCHANGE}`, {}),
    ]);
    expect(py.status).toBe(422);
    expect(ts.status).toBe(422);
    expect((py.json as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
    expect((ts.json as { error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("connections — token at rest (DA-12)", () => {
  it("FastAPI-written token has NO plaintext at rest and decrypts in NestJS-land (node:crypto)", async () => {
    await cleanupConnectionsFixture();
    const res = await postJson(`${pyBase}${EXCHANGE}`, {
      public_token: "public-fake",
    });
    expect(res.status).toBe(200);

    const blob = await readPlaidItemToken(FAKE_ITEM_ID);
    expect(blob).not.toBeNull();
    // No plaintext token substring in the BYTEA column.
    expect(blob!.includes(Buffer.from(FAKE_ACCESS_TOKEN))).toBe(false);
    // Cross-backend: a Python-written blob decrypts with the TS node:crypto path.
    expect(decryptTokenNode(blob!, PARITY_ENCRYPTION_KEY)).toBe(
      FAKE_ACCESS_TOKEN,
    );
  });

  it("NestJS-written token decrypts in Python-land (cryptography.AESGCM)", async () => {
    await cleanupConnectionsFixture();
    const res = await postJson(`${tsBase}${EXCHANGE}`, {
      public_token: "public-fake",
    });
    expect(res.status).toBe(200);

    const blob = await readPlaidItemToken(FAKE_ITEM_ID);
    expect(blob).not.toBeNull();
    expect(blob!.includes(Buffer.from(FAKE_ACCESS_TOKEN))).toBe(false);
    // Cross-backend: a TS-written blob decrypts with the Python AESGCM path.
    expect(decryptTokenPython(blob!, PARITY_ENCRYPTION_KEY)).toBe(
      FAKE_ACCESS_TOKEN,
    );
  });
});

describe("connections — GET /connections snapshot parity", () => {
  it("returns an identical {items, sources} snapshot after a link", async () => {
    await postJson(`${pyBase}${EXCHANGE}`, { public_token: "public-fake" });
    const [py, ts] = await Promise.all([
      getJson(`${pyBase}${CONNECTIONS}`),
      getJson(`${tsBase}${CONNECTIONS}`),
    ]);
    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);

    const body = py.json as {
      items: Array<Record<string, unknown>>;
      sources: Array<{ source: string; mode: string; status: string }>;
    };
    expect(Object.keys(body).sort()).toEqual(["items", "sources"]);
    expect(body.sources.map((s) => s.source)).toEqual([
      "transactions",
      "income",
      "holdings",
      "loans",
      "listings",
    ]);
    const tx = body.sources.find((s) => s.source === "transactions")!;
    expect(tx.status).toBe("connected");
    // The serialized snapshot never contains a plaintext token.
    expect(JSON.stringify(body)).not.toContain(FAKE_ACCESS_TOKEN);
  });
});

describe("connections — webhook verification parity (DA-11)", () => {
  it("a correctly signed webhook -> identical {status:accepted}", async () => {
    const rawBody = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
    });
    const jwt = await signWebhook(rawBody);
    const [py, ts] = await Promise.all([
      postJson(`${pyBase}${WEBHOOK}`, rawBody, { "plaid-verification": jwt }),
      postJson(`${tsBase}${WEBHOOK}`, rawBody, { "plaid-verification": jwt }),
    ]);
    expect(py.status).toBe(200);
    expect(ts.status).toBe(200);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({ status: "accepted" });
  });

  it("an UNSIGNED webhook -> identical canonical 401", async () => {
    const rawBody = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "X",
    });
    const [py, ts] = await Promise.all([
      postJson(`${pyBase}${WEBHOOK}`, rawBody),
      postJson(`${tsBase}${WEBHOOK}`, rawBody),
    ]);
    expect(py.status).toBe(401);
    expect(ts.status).toBe(401);
    expect(py.json).toEqual(ts.json);
    expect(py.json).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Webhook signature verification failed.",
        details: [],
      },
    });
  });

  it("a FORGED-signature webhook -> identical canonical 401", async () => {
    const rawBody = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "X",
    });
    // A JWT whose body-hash is wrong (tampered body) — signature won't validate
    // the claim even if structurally a JWT; both backends must reject -> 401.
    const forged =
      "eyJhbGciOiJFUzI1NiIsImtpZCI6InBmLWZha2Uta2lkLTEifQ." +
      "eyJpYXQiOjEwMDAwMDAwMDAsInJlcXVlc3RfYm9keV9zaGEyNTYiOiJkZWFkYmVlZiJ9." +
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const [py, ts] = await Promise.all([
      postJson(`${pyBase}${WEBHOOK}`, rawBody, {
        "plaid-verification": forged,
      }),
      postJson(`${tsBase}${WEBHOOK}`, rawBody, {
        "plaid-verification": forged,
      }),
    ]);
    expect(py.status).toBe(401);
    expect(ts.status).toBe(401);
    expect(py.json).toEqual(ts.json);
  });
});

describe("connections — log scrub (DA-14)", () => {
  it("neither backend ever logs the access/public/link token", async () => {
    // Generate log lines on BOTH backends (link + exchange + signed webhook).
    const rawBody = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
    });
    const jwt = await signWebhook(rawBody);
    for (const base of [pyBase, tsBase]) {
      await postJson(`${base}${LINK}`, { products: ["transactions"] });
      await postJson(`${base}${EXCHANGE}`, { public_token: "public-fake" });
      await postJson(`${base}${WEBHOOK}`, rawBody, {
        "plaid-verification": jwt,
      });
    }
    // Let the piped stdout flush to the capture files.
    await new Promise((r) => setTimeout(r, 500));

    const pyLogs = readFileSync(PY_LOG_FILE, "utf8");
    const tsLogs = readFileSync(TS_LOG_FILE, "utf8");
    // The activity DID get logged (sanity: the capture is wired)...
    expect(pyLogs.length + tsLogs.length).toBeGreaterThan(0);
    // ...but no secret token string ever appears.
    for (const logs of [pyLogs, tsLogs]) {
      expect(logs).not.toContain(FAKE_ACCESS_TOKEN);
      expect(logs).not.toContain("public-fake");
      expect(logs).not.toContain("link-sandbox-fake-0000");
    }
  });
});

describe("connections — OAuth redirect allowlist (no open redirect)", () => {
  it("a non-allowlisted redirect_uri is rejected identically across backends", async () => {
    const evil = encodeURIComponent("http://evil.example.com/steal");
    const [py, ts] = await Promise.all([
      fetch(`${pyBase}${OAUTH}?redirect_uri=${evil}`, { redirect: "manual" }),
      fetch(`${tsBase}${OAUTH}?redirect_uri=${evil}`, { redirect: "manual" }),
    ]);
    // Neither backend follows the non-allowlisted target (no 3xx Location).
    expect(py.status).toBe(422);
    expect(ts.status).toBe(422);
    const pj = (await py.json()) as { error: { code: string } };
    const tj = (await ts.json()) as { error: { code: string } };
    expect(pj.error.code).toBe("VALIDATION_ERROR");
    expect(tj.error.code).toBe("VALIDATION_ERROR");
  });

  it("an allowlisted redirect_uri returns a 307 to that exact URI (both backends)", async () => {
    const ok = "http://localhost:5173/oauth";
    const [py, ts] = await Promise.all([
      fetch(`${pyBase}${OAUTH}?redirect_uri=${encodeURIComponent(ok)}`, {
        redirect: "manual",
      }),
      fetch(`${tsBase}${OAUTH}?redirect_uri=${encodeURIComponent(ok)}`, {
        redirect: "manual",
      }),
    ]);
    expect(py.status).toBe(307);
    expect(ts.status).toBe(307);
    expect(py.headers.get("location")).toBe(ok);
    expect(ts.headers.get("location")).toBe(ok);
  });
});
