import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { connectionsFixture } from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { SettingsScreen } from './SettingsScreen';

const CONNECTIONS_URL = `${apiBaseUrl}/api/v1/connections`;

// usePlaidLink is mocked everywhere so no real Plaid Link opens (DATA PRIVACY).
// This default stub never reports `ready`, so connect() stays in its busy phase
// without launching the widget — enough for state-rendering assertions.
vi.mock('react-plaid-link', () => ({
  usePlaidLink: () => ({ open: vi.fn(), exit: vi.fn(), ready: false, error: null }),
}));

describe('SettingsScreen', () => {
  it('shows a loading status, then renders a card per source', async () => {
    renderWithProviders(<SettingsScreen />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /data sources & connections/i }),
      ).toBeInTheDocument(),
    );
    // One card per source family from the synthetic fixture.
    expect(screen.getByRole('heading', { name: /bank & card transactions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /pay stubs & income/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /brokerage holdings/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /student loans/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /real-estate comps/i })).toBeInTheDocument();
  });

  it('renders all four item_status states with the right badge', async () => {
    renderWithProviders(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );

    // connected (transactions, loans), error (income), needs_reauth (holdings),
    // not_connected (listings). Badges repeat across the source cards and the
    // linked-accounts summary, so assert each label appears at least once.
    expect(screen.getAllByText(/^Connected$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sync error/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/needs reconnect/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });

  it('shows a Reconnect CTA for needs_reauth and error, Connect for not_connected', async () => {
    renderWithProviders(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );

    // error (income) + needs_reauth (holdings) each get a Reconnect button.
    const reconnects = screen.getAllByRole('button', { name: /^reconnect$/i });
    expect(reconnects.length).toBe(2);

    // not_connected (listings) gets a Connect button.
    expect(screen.getAllByRole('button', { name: /^connect$/i }).length).toBe(1);
  });

  it('offers no connect/reconnect CTA beyond the unconnected/needs-attention sources', async () => {
    renderWithProviders(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );
    // Only the 2 attention sources + 1 not_connected source expose a CTA; the
    // 2 connected sources (transactions, loans) expose none.
    expect(screen.getAllByRole('button', { name: /^connect$|^reconnect$/i }).length).toBe(3);
  });

  it('summarises linked Plaid Items with their institution and status', async () => {
    renderWithProviders(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /linked accounts/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/example bank/i)).toBeInTheDocument();
    expect(screen.getByText(/sample brokerage/i)).toBeInTheDocument();
    expect(screen.getByText(/last synced 2026-05-24/i)).toBeInTheDocument();
  });

  it('re-fetches the connections snapshot after a mode toggle (reload wiring)', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    server.use(
      http.get(CONNECTIONS_URL, () => {
        getCount += 1;
        return HttpResponse.json(connectionsFixture);
      }),
      http.post(`${apiBaseUrl}/api/v1/connections/source-mode`, () =>
        HttpResponse.json(connectionsFixture),
      ),
    );

    renderWithProviders(<SettingsScreen />);
    await waitFor(() => expect(getCount).toBe(1));

    // Flip the listings source (local -> api): the screen reloads the snapshot.
    const localRadios = screen.getAllByRole('radio', { name: /live api/i });
    await user.click(localRadios[localRadios.length - 1]);

    await waitFor(() => expect(getCount).toBe(2));
  });

  it('renders an upload control per ingest source, including a standalone accounts card', async () => {
    renderWithProviders(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );

    // transactions, income (multiple) -> "Choose files"; holdings, loans,
    // accounts (single) -> "Choose file". 2 multi + 3 single = 5 controls,
    // proving every ingest source (incl. accounts, which has no Plaid row) has
    // an upload affordance and listings (no ingest route) does not.
    const choosers = screen.getAllByLabelText(/choose files?/i);
    expect(choosers).toHaveLength(5);

    // The accounts upload is its own panel (it powers Net Worth via YAML).
    expect(
      screen.getByRole('heading', { name: /account balances/i }),
    ).toBeInTheDocument();
  });

  it('refetches the connections snapshot after a successful upload (invalidation)', async () => {
    const user = userEvent.setup();
    let getCount = 0;
    server.use(
      http.get(CONNECTIONS_URL, () => {
        getCount += 1;
        return HttpResponse.json(connectionsFixture);
      }),
      http.post(`${apiBaseUrl}/api/v1/ingest/:source`, ({ params }) =>
        HttpResponse.json({
          source: String(params.source),
          files: [{ filename: 'holdings.csv', detected_type: 'etrade_csv', rows: 3 }],
          total_rows: 3,
        }),
      ),
    );

    renderWithProviders(<SettingsScreen />);
    await waitFor(() => expect(getCount).toBe(1));

    // Upload to the brokerage-holdings card (single-file picker). Scope the
    // submit button to the same control so we click the matching one.
    const file = new File(['Symbol,Qty\n'], 'holdings.csv', { type: 'text/csv' });
    const holdingsInput = screen.getAllByLabelText(/choose file$/i)[0];
    await user.upload(holdingsInput, file);
    const control = holdingsInput.closest('div.flex.flex-col.gap-2') as HTMLElement;
    const { getByRole } = within(control);
    await user.click(getByRole('button', { name: /upload & ingest/i }));

    // A successful ingest invalidates the snapshot -> a second GET.
    await waitFor(() => expect(getCount).toBe(2));
  });

  it('renders an error alert with a retry button on 503', async () => {
    server.use(
      http.get(CONNECTIONS_URL, () =>
        HttpResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.', details: [] } },
          { status: 503 },
        ),
      ),
    );
    renderWithProviders(<SettingsScreen />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/database unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
