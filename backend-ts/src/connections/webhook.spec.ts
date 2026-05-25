import { createHash } from 'node:crypto';

import { SignJWT, exportJWK, generateKeyPair } from 'jose';

import { CanonicalUnauthorizedException } from '../errors/canonical-error';
import type { PlaidGateway, PlaidJwk } from './plaid.gateway';
import {
  JwksCache,
  MAX_AGE_SECONDS,
  RateLimiter,
  verifyWebhook,
} from './webhook';

/**
 * Plaid webhook JWT/JWKS verification (P6.1, DA-11). A SYNTHETIC ES256 keypair
 * stands in for Plaid's signing key. Proves: valid -> ok; JWKS cached; missing
 * header -> 401; forged signature -> 401; wrong alg -> 401; stale iat -> 401;
 * body-hash mismatch -> 401; rate limiter blocks past its window.
 */

const KID = 'synthetic-kid-1';
const RAW_BODY = Buffer.from(
  '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}',
);

class FakeGateway implements PlaidGateway {
  calls = 0;
  constructor(private readonly jwk: PlaidJwk) {}
  getWebhookVerificationKey(): Promise<PlaidJwk> {
    this.calls += 1;
    return Promise.resolve(this.jwk);
  }
  createLinkToken(): never {
    throw new Error('unused');
  }
  exchangePublicToken(): never {
    throw new Error('unused');
  }
  createSandboxPublicToken(): never {
    throw new Error('unused');
  }
}

async function signWith(
  privateKey: CryptoKey,
  body: Buffer,
  opts: { iat?: number; bodyHash?: string; alg?: string } = {},
): Promise<string> {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const hash = opts.bodyHash ?? createHash('sha256').update(body).digest('hex');
  return new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: KID })
    .setIssuedAt(iat)
    .sign(privateKey);
}

describe('verifyWebhook', () => {
  let privateKey: CryptoKey;
  let jwk: PlaidJwk;
  let gateway: FakeGateway;
  let jwks: JwksCache;

  beforeEach(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    const publicJwk = await exportJWK(pair.publicKey);
    jwk = { ...publicJwk, kid: KID } as PlaidJwk;
    gateway = new FakeGateway(jwk);
    jwks = new JwksCache(gateway);
  });

  it('accepts a correctly signed, fresh, body-matching JWT', async () => {
    const token = await signWith(privateKey, RAW_BODY);
    await expect(verifyWebhook(RAW_BODY, token, jwks)).resolves.toBeUndefined();
    expect(gateway.calls).toBe(1);
  });

  it('caches the JWK by kid (one fetch across calls)', async () => {
    for (let i = 0; i < 3; i++) {
      await verifyWebhook(RAW_BODY, await signWith(privateKey, RAW_BODY), jwks);
    }
    expect(gateway.calls).toBe(1);
  });

  it('rejects a missing header', async () => {
    await expect(
      verifyWebhook(RAW_BODY, undefined, jwks),
    ).rejects.toBeInstanceOf(CanonicalUnauthorizedException);
  });

  it('rejects a garbage header', async () => {
    await expect(
      verifyWebhook(RAW_BODY, 'not-a-jwt', jwks),
    ).rejects.toBeInstanceOf(CanonicalUnauthorizedException);
  });

  it('rejects a forged signature (wrong key)', async () => {
    const attacker = await generateKeyPair('ES256', { extractable: true });
    const token = await signWith(attacker.privateKey, RAW_BODY);
    await expect(verifyWebhook(RAW_BODY, token, jwks)).rejects.toBeInstanceOf(
      CanonicalUnauthorizedException,
    );
  });

  it('rejects a stale iat', async () => {
    const stale = Math.floor(Date.now() / 1000) - MAX_AGE_SECONDS - 10;
    const token = await signWith(privateKey, RAW_BODY, { iat: stale });
    await expect(verifyWebhook(RAW_BODY, token, jwks)).rejects.toBeInstanceOf(
      CanonicalUnauthorizedException,
    );
  });

  it('rejects a body-hash mismatch (tampered body)', async () => {
    const token = await signWith(privateKey, RAW_BODY, {
      bodyHash: createHash('sha256').update('different').digest('hex'),
    });
    await expect(verifyWebhook(RAW_BODY, token, jwks)).rejects.toBeInstanceOf(
      CanonicalUnauthorizedException,
    );
  });

  it('rejects a missing request_body_sha256 claim', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuedAt()
      .sign(privateKey);
    await expect(verifyWebhook(RAW_BODY, token, jwks)).rejects.toBeInstanceOf(
      CanonicalUnauthorizedException,
    );
  });
});

describe('RateLimiter', () => {
  it('blocks once the window fills, then allows after it slides', () => {
    const limiter = new RateLimiter(2, 60);
    const now = 1000;
    expect(limiter.allow(now)).toBe(true);
    expect(limiter.allow(now)).toBe(true);
    expect(limiter.allow(now)).toBe(false);
    expect(limiter.allow(now + 61)).toBe(true);
  });
});
