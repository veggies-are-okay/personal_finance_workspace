import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlaidLinkOptions } from 'react-plaid-link';
import { http, HttpResponse } from 'msw';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { ConnectButton } from './ConnectButton';

/**
 * Controllable `usePlaidLink` mock — the ONLY Plaid coupling, mocked so the
 * Link widget never opens (DATA PRIVACY: no real Plaid creds/tokens). It
 * captures the latest config and reports `ready: true` so the hook's open()
 * fires; the test then drives the flow by invoking the captured `onSuccess`.
 */
let lastConfig: PlaidLinkOptions | null = null;
const openSpy = vi.fn();

vi.mock('react-plaid-link', () => ({
  usePlaidLink: (config: PlaidLinkOptions) => {
    lastConfig = config;
    return { open: openSpy, exit: vi.fn(), ready: true, error: null };
  },
}));

const LINK_TOKEN_URL = `${apiBaseUrl}/api/v1/connections/link-token`;
const EXCHANGE_URL = `${apiBaseUrl}/api/v1/connections/exchange`;

beforeEach(() => {
  lastConfig = null;
  openSpy.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('ConnectButton (mock-driven Plaid Link flow)', () => {
  it('renders nothing for a managed (connected) source', () => {
    const { container } = render(
      <ConnectButton affordance="manage" products={['transactions']} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the CTA "Reconnect" for the reconnect affordance (update mode)', () => {
    render(<ConnectButton affordance="reconnect" products={['investments']} />);
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
  });

  it('runs link-token -> open Link -> exchange and fires onConnected', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    let sentPublicToken: string | undefined;

    server.use(
      http.post(LINK_TOKEN_URL, async ({ request }) => {
        requested.push('link-token');
        // The Link session requests the source's products.
        const body = (await request.json()) as { products?: string[] };
        expect(body.products).toEqual(['transactions']);
        return HttpResponse.json({
          link_token: 'link-sandbox-0000-synthetic',
          expiration: '2026-05-24T10:30:00Z',
        });
      }),
      http.post(EXCHANGE_URL, async ({ request }) => {
        requested.push('exchange');
        const body = (await request.json()) as { public_token: string };
        sentPublicToken = body.public_token;
        return HttpResponse.json({ item_id: 'item-synthetic-001', status: 'connected' });
      }),
    );

    const onConnected = vi.fn();
    render(
      <ConnectButton affordance="connect" products={['transactions']} onConnected={onConnected} />,
    );

    await user.click(screen.getByRole('button', { name: /^connect/i }));

    // 1) link token requested, 2) Plaid Link opened once it was ready.
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(requested).toContain('link-token');

    // Simulate the user finishing Plaid Link -> exchange the public_token.
    expect(lastConfig?.onSuccess).toBeTypeOf('function');
    lastConfig!.onSuccess('public-sandbox-0000-synthetic', {
      institution: null,
      accounts: [],
      link_session_id: 'sess-synthetic',
    });

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(requested).toEqual(['link-token', 'exchange']);
    expect(sentPublicToken).toBe('public-sandbox-0000-synthetic');
  });

  it('surfaces an error when the link-token request fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(LINK_TOKEN_URL, () =>
        HttpResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Plaid unavailable.', details: [] } },
          { status: 503 },
        ),
      ),
    );

    render(<ConnectButton affordance="connect" products={['transactions']} />);
    await user.click(screen.getByRole('button', { name: /^connect/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/plaid unavailable/i));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('surfaces an error when the exchange fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(LINK_TOKEN_URL, () =>
        HttpResponse.json({ link_token: 'link-sandbox-0000-synthetic', expiration: '2026-05-24T10:30:00Z' }),
      ),
      http.post(EXCHANGE_URL, () =>
        HttpResponse.json(
          { error: { code: 'EXCHANGE_FAILED', message: 'Exchange failed.', details: [] } },
          { status: 503 },
        ),
      ),
    );

    render(<ConnectButton affordance="connect" products={['transactions']} />);
    await user.click(screen.getByRole('button', { name: /^connect/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    lastConfig!.onSuccess('public-sandbox-0000-synthetic', {
      institution: null,
      accounts: [],
      link_session_id: 'sess-synthetic',
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/exchange failed/i));
  });

  it('returns to idle when the user exits Plaid Link without an error', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(LINK_TOKEN_URL, () =>
        HttpResponse.json({ link_token: 'link-sandbox-0000-synthetic', expiration: '2026-05-24T10:30:00Z' }),
      ),
    );

    render(<ConnectButton affordance="connect" products={['transactions']} />);
    await user.click(screen.getByRole('button', { name: /^connect/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    // User dismissed Link with no error -> flow resets, CTA is enabled again.
    lastConfig!.onExit?.(null, { institution: null, status: null, link_session_id: 'sess', request_id: 'req' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^connect/i })).toBeEnabled(),
    );
  });

  it('surfaces a Plaid error reported on exit', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(LINK_TOKEN_URL, () =>
        HttpResponse.json({ link_token: 'link-sandbox-0000-synthetic', expiration: '2026-05-24T10:30:00Z' }),
      ),
    );

    render(<ConnectButton affordance="connect" products={['transactions']} />);
    await user.click(screen.getByRole('button', { name: /^connect/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    lastConfig!.onExit?.(
      {
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_message: 'item login required',
        display_message: 'Please sign in again.',
      },
      { institution: null, status: null, link_session_id: 'sess', request_id: 'req' },
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/please sign in again/i),
    );
  });
});
