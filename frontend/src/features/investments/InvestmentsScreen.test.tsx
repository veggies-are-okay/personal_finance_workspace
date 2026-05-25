import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { emptyInvestments } from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { InvestmentsScreen } from './InvestmentsScreen';

const URL = `${apiBaseUrl}/api/v1/investments`;

describe('InvestmentsScreen', () => {
  it('renders holdings, allocation meters, and concentration', async () => {
    renderWithProviders(<InvestmentsScreen />);
    await waitFor(() =>
      expect(screen.getByText('Broad Market Index ETF')).toBeInTheDocument(),
    );
    expect(screen.getByText(/portfolio value/i)).toBeInTheDocument();
    expect(screen.getAllByRole('meter').length).toBeGreaterThan(0);
    // A losing holding shows a negative gain (BND in the fixture).
    expect(screen.getByText('-$260.00')).toBeInTheDocument();
  });

  it('shows the not_connected empty state when there are no holdings', async () => {
    server.use(http.get(URL, () => HttpResponse.json(emptyInvestments)));
    renderWithProviders(<InvestmentsScreen />);
    await waitFor(() => expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument());
  });
});
