import {
  FAKE_ACCESS_TOKEN,
  FAKE_ITEM_ID,
  FAKE_JWK,
  FakePlaidGateway,
} from './fake-gateway';

/**
 * The network-free fake Plaid gateway (P6.1) used by the parity harness + CI
 * (PLAID_FAKE=1). Pins its canned returns + the fixed synthetic JWK so the
 * cross-backend webhook-verification parity test has a stable key to sign with.
 */
describe('FakePlaidGateway', () => {
  const gw = new FakePlaidGateway();

  it('returns canned link/exchange data', async () => {
    const link = await gw.createLinkToken();
    expect(link.linkToken).toMatch(/^link-sandbox-fake/);
    const ex = await gw.exchangePublicToken();
    expect(ex.itemId).toBe(FAKE_ITEM_ID);
    expect(ex.accessToken).toBe(FAKE_ACCESS_TOKEN);
  });

  it('serves the fixed synthetic JWK + a sandbox public token', async () => {
    expect(await gw.getWebhookVerificationKey()).toEqual(FAKE_JWK);
    expect(await gw.createSandboxPublicToken()).toMatch(/^public-sandbox-fake/);
  });
});
