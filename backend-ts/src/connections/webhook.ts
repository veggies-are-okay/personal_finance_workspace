import { createHash, timingSafeEqual } from 'node:crypto';

import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';

import { CanonicalUnauthorizedException } from '../errors/canonical-error';
import type { PlaidGateway, PlaidJwk } from './plaid.gateway';

/**
 * Plaid webhook JWT/JWKS verification (DA-11) + a tiny rate limiter — parity
 * twin of `backend-python/app/connections/webhook.py`.
 *
 * Flow (current public Plaid flow, confirmed via research):
 * 1. Read the RAW request body bytes (before JSON parsing).
 * 2. Decode the JWT header WITHOUT verifying; require `alg === "ES256"` + a `kid`.
 * 3. Fetch the JWK for that `kid` from `/webhook_verification_key/get` (cached by
 *    kid; injected gateway in tests so CI is hermetic).
 * 4. Verify the JWT SIGNATURE with the JWK (ES256).
 * 5. Check `iat` freshness — reject if older than `MAX_AGE_SECONDS` (5 min).
 * 6. SHA-256(raw body) must equal the JWT's `request_body_sha256` (constant-time).
 *
 * Any failure throws `CanonicalUnauthorizedException` -> canonical 401. The
 * verifier NEVER logs the body, the JWT, or the token (DA-14).
 */

export const ALGORITHM = 'ES256';
export const MAX_AGE_SECONDS = 300; // 5-minute freshness window (replay guard).

/** Caches Plaid JWKs by `kid` (fetched via the injected gateway). */
export class JwksCache {
  private readonly cache = new Map<string, PlaidJwk>();

  constructor(private readonly gateway: PlaidGateway) {}

  async getKey(kid: string): Promise<PlaidJwk> {
    const cached = this.cache.get(kid);
    if (cached) return cached;
    const key = await this.gateway.getWebhookVerificationKey(kid);
    this.cache.set(kid, key);
    return key;
  }
}

/** Fixed-window in-memory rate limiter (per-process; single-user app). */
export class RateLimiter {
  private readonly events: number[] = [];

  constructor(
    private readonly max = 60,
    private readonly windowSeconds = 60,
  ) {}

  allow(now: number = Date.now() / 1000): boolean {
    const cutoff = now - this.windowSeconds;
    while (this.events.length > 0 && this.events[0] < cutoff) {
      this.events.shift();
    }
    if (this.events.length >= this.max) return false;
    this.events.push(now);
    return true;
  }
}

interface WebhookClaims {
  iat?: number;
  request_body_sha256?: string;
}

/** Constant-time string compare (hex digests of equal length). */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Verify a Plaid webhook; throw `CanonicalUnauthorizedException` on ANY failure. */
export async function verifyWebhook(
  rawBody: Buffer,
  verificationHeader: string | undefined,
  jwks: JwksCache,
  now: number = Date.now() / 1000,
): Promise<void> {
  if (!verificationHeader) {
    throw new CanonicalUnauthorizedException();
  }

  // 1) Decode the JWT header unverified -> alg + kid.
  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(verificationHeader);
  } catch {
    throw new CanonicalUnauthorizedException();
  }
  if (header.alg !== ALGORITHM || !header.kid) {
    throw new CanonicalUnauthorizedException();
  }

  // 2) Fetch the JWK + import the EC public key.
  let key: Awaited<ReturnType<typeof importJWK>>;
  try {
    const jwk = await jwks.getKey(header.kid);
    key = await importJWK(jwk, ALGORITHM);
  } catch {
    throw new CanonicalUnauthorizedException();
  }

  // 3) Verify the signature (restrict to ES256). We DO NOT rely on jose's exp
  //    handling; iat freshness is enforced ourselves to match Plaid's flow.
  let claims: WebhookClaims;
  try {
    const result = await jwtVerify(verificationHeader, key, {
      algorithms: [ALGORITHM],
    });
    claims = result.payload;
  } catch {
    throw new CanonicalUnauthorizedException();
  }

  // 4) iat freshness.
  if (typeof claims.iat !== 'number' || now - claims.iat > MAX_AGE_SECONDS) {
    throw new CanonicalUnauthorizedException();
  }

  // 5) Body integrity: SHA-256(raw body) === request_body_sha256 (constant-time).
  const expected = claims.request_body_sha256;
  if (typeof expected !== 'string') {
    throw new CanonicalUnauthorizedException();
  }
  const actual = createHash('sha256').update(rawBody).digest('hex');
  if (!constantTimeEqual(actual, expected)) {
    throw new CanonicalUnauthorizedException();
  }
}
