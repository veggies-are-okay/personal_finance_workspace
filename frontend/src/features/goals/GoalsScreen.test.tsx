import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { emptyGoals } from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { GoalsScreen } from './GoalsScreen';

const URL = `${apiBaseUrl}/api/v1/goals`;

describe('GoalsScreen', () => {
  it('renders progress, funding sources, and the affordability snapshot', async () => {
    renderWithProviders(<GoalsScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /home down payment/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText(/monthly piti/i)).toBeInTheDocument();
    expect(screen.getByText('High-yield Savings')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('shows the not_connected empty state when no goal is set', async () => {
    server.use(http.get(URL, () => HttpResponse.json(emptyGoals)));
    renderWithProviders(<GoalsScreen />);
    await waitFor(() => expect(screen.getByText(/no goal set yet/i)).toBeInTheDocument());
  });
});
