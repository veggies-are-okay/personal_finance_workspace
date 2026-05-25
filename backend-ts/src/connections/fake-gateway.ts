import type {
  ExchangeResult,
  LinkToken,
  PlaidGateway,
  PlaidJwk,
} from './plaid.gateway';

/**
 * A deterministic, network-free Plaid gateway for hermetic parity/CI runs.
 *
 * Activated by `PLAID_FAKE=1` (set by the `contracts/` parity harness and CI).
 * Returns canned link/exchange data and serves a FIXED synthetic ES256 JWK
 * (`FAKE_JWK`) — byte-for-byte identical to
 * `backend-python/app/connections/fake_gateway.py`, so a webhook signed with the
 * matching synthetic private key verifies identically in BOTH backends.
 *
 * SYNTHETIC test material only — never a real Plaid key/token.
 */

export const FAKE_JWK: PlaidJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'zcWqQdsXEO_rEU-1SRUz7G2xlgHOOKEPrLdNObL94bc',
  y: 'F838KToH8Cn-eVqGP6_NDCTSuPeMa8S9I7X6IdxjvT4',
  kid: 'pf-fake-kid-1',
  alg: 'ES256',
  use: 'sig',
};

export const FAKE_LINK_TOKEN = 'link-sandbox-fake-0000';
export const FAKE_ITEM_ID = 'item-fake-0001';
export const FAKE_ACCESS_TOKEN = 'access-fake-do-not-store-plaintext';
export const FAKE_EXPIRATION = '2026-05-24T10:30:00.000Z';

export class FakePlaidGateway implements PlaidGateway {
  createLinkToken(): Promise<LinkToken> {
    return Promise.resolve({
      linkToken: FAKE_LINK_TOKEN,
      expiration: FAKE_EXPIRATION,
    });
  }
  exchangePublicToken(): Promise<ExchangeResult> {
    return Promise.resolve({
      accessToken: FAKE_ACCESS_TOKEN,
      itemId: FAKE_ITEM_ID,
    });
  }
  getWebhookVerificationKey(): Promise<PlaidJwk> {
    return Promise.resolve(FAKE_JWK);
  }
  createSandboxPublicToken(): Promise<string> {
    return Promise.resolve('public-sandbox-fake-0000');
  }
}
