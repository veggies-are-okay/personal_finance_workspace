import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import {
  ApiRequestError,
  apiBaseUrl,
  createLinkToken,
  exchangePublicToken,
  getConnections,
  setSourceMode,
} from './api';

describe('connections API client (against the contract mock)', () => {
  it('getConnections returns the snapshot with per-source mode + status', async () => {
    const snapshot = await getConnections();
    expect(snapshot.sources.length).toBe(5);
    expect(snapshot.sources.map((s) => s.source)).toContain('transactions');
    expect(snapshot.items.length).toBeGreaterThan(0);
  });

  it('createLinkToken POSTs the requested products and returns a token', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${apiBaseUrl}/api/v1/connections/link-token`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({
          link_token: 'link-sandbox-0000-synthetic',
          expiration: '2026-05-24T10:30:00Z',
        });
      }),
    );

    const res = await createLinkToken({ products: ['transactions'] });
    expect(res.link_token).toMatch(/^link-/);
    expect(seenBody).toEqual({ products: ['transactions'] });
  });

  it('exchangePublicToken POSTs the public_token and returns the item status', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${apiBaseUrl}/api/v1/connections/exchange`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ item_id: 'item-synthetic-001', status: 'connected' });
      }),
    );

    const res = await exchangePublicToken('public-sandbox-0000-synthetic');
    expect(res.status).toBe('connected');
    expect(seenBody).toEqual({ public_token: 'public-sandbox-0000-synthetic' });
  });

  it('setSourceMode POSTs the source + target mode and returns the new snapshot', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${apiBaseUrl}/api/v1/connections/source-mode`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({
          items: [],
          sources: [{ source: 'holdings', mode: 'local', status: 'not_connected' }],
        });
      }),
    );

    const snapshot = await setSourceMode('holdings', 'local');
    expect(seenBody).toEqual({ source: 'holdings', mode: 'local' });
    expect(snapshot.sources[0].mode).toBe('local');
  });

  it('throws ApiRequestError with the canonical message on a POST 503', async () => {
    server.use(
      http.post(`${apiBaseUrl}/api/v1/connections/link-token`, () =>
        HttpResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Plaid unavailable.', details: [] } },
          { status: 503 },
        ),
      ),
    );

    await expect(createLinkToken()).rejects.toBeInstanceOf(ApiRequestError);
    await expect(createLinkToken()).rejects.toThrow(/Plaid unavailable/);
  });

  it('falls back to a generic message when a POST error body is not JSON', async () => {
    server.use(
      http.post(`${apiBaseUrl}/api/v1/connections/exchange`, () =>
        HttpResponse.text('boom', { status: 500 }),
      ),
    );
    await expect(exchangePublicToken('public-x')).rejects.toThrow(/HTTP 500/);
  });
});
