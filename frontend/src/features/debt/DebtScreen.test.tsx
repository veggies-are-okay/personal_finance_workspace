import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { emptyDebt } from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { DebtScreen } from './DebtScreen';

const URL = `${apiBaseUrl}/api/v1/debt`;

describe('DebtScreen', () => {
  it('renders loans, payoff outlook, and the avalanche-vs-minimums insight', async () => {
    renderWithProviders(<DebtScreen />);
    await waitFor(() =>
      expect(screen.getByText('Grad PLUS — 2020')).toBeInTheDocument(),
    );
    expect(screen.getByText(/total debt/i)).toBeInTheDocument();
    // Both payoff strategies are surfaced as outlook cards.
    expect(screen.getByText(/debt-free by 2031/i)).toBeInTheDocument();
    expect(screen.getByText(/debt-free by 2036/i)).toBeInTheDocument();
  });

  it('shows the not_connected empty state when there are no loans', async () => {
    server.use(http.get(URL, () => HttpResponse.json(emptyDebt)));
    renderWithProviders(<DebtScreen />);
    await waitFor(() => expect(screen.getByText(/no loans yet/i)).toBeInTheDocument());
  });
});
