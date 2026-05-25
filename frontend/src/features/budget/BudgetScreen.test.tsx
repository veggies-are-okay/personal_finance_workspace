import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { emptyBudget } from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { BudgetScreen } from './BudgetScreen';

const BUDGET_URL = `${apiBaseUrl}/api/v1/budget`;

describe('BudgetScreen', () => {
  it('shows a loading status, then renders the budget data', async () => {
    renderWithProviders(<BudgetScreen />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /budget & spending/i }),
      ).toBeInTheDocument(),
    );
    // KPI + a known recurring merchant from the synthetic fixture.
    expect(screen.getByText(/savings rate/i)).toBeInTheDocument();
    expect(screen.getByText(/Maple Property Mgmt/)).toBeInTheDocument();
    // The 50/30/20 meter exposes an accessible value.
    expect(screen.getAllByRole('meter').length).toBeGreaterThan(0);
  });

  it('renders a friendly not_connected empty state, not an error (DA-20)', async () => {
    server.use(http.get(BUDGET_URL, () => HttpResponse.json(emptyBudget)));
    renderWithProviders(<BudgetScreen />);

    await waitFor(() =>
      expect(screen.getByText(/no budget yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/connect a transactions source/i),
    ).toBeInTheDocument();
    // A not-connected state is friendly, never an error alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an error alert with a retry button on 503', async () => {
    server.use(
      http.get(BUDGET_URL, () =>
        HttpResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.', details: [] } },
          { status: 503 },
        ),
      ),
    );
    renderWithProviders(<BudgetScreen />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/database unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
