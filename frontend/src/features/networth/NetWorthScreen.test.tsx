import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { emptyNetworth } from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { NetWorthScreen } from './NetWorthScreen';

const URL = `${apiBaseUrl}/api/v1/networth`;

describe('NetWorthScreen', () => {
  it('renders accounts with a signed 30-day delta', async () => {
    renderWithProviders(<NetWorthScreen />);
    await waitFor(() =>
      expect(screen.getByText('Individual Brokerage')).toBeInTheDocument(),
    );
    // A negative delta is shown with the native minus sign (not color alone).
    expect(screen.getByText('-$410.00')).toBeInTheDocument();
    expect(screen.getByText('+$2,940.00')).toBeInTheDocument();
  });

  it('shows the not_connected empty state when there are no accounts', async () => {
    server.use(http.get(URL, () => HttpResponse.json(emptyNetworth)));
    renderWithProviders(<NetWorthScreen />);
    await waitFor(() => expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument());
  });
});
