import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import {
  emptyBudget,
  emptyDebt,
  emptyGoals,
  emptyInvestments,
  emptyNetworth,
} from '../../mocks/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import { StoryScreen } from './StoryScreen';

describe('StoryScreen', () => {
  it('composes cross-domain highlights with View links to each screen', async () => {
    renderWithProviders(<StoryScreen />);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /your financial story/i }),
      ).toBeInTheDocument(),
    );

    // Narrative callout + the "Explore your story" card grid.
    expect(screen.getByRole('complementary', { name: /insight/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /^budget$/i }),
    ).toBeInTheDocument();
    const viewLinks = screen.getAllByRole('link', { name: /view →/i });
    expect(viewLinks.length).toBeGreaterThanOrEqual(5);
    expect(viewLinks.some((a) => a.getAttribute('href') === '/budget')).toBe(true);
  });

  it('shows the get-connected empty state when every domain is empty', async () => {
    server.use(
      http.get(`${apiBaseUrl}/api/v1/budget`, () => HttpResponse.json(emptyBudget)),
      http.get(`${apiBaseUrl}/api/v1/networth`, () => HttpResponse.json(emptyNetworth)),
      http.get(`${apiBaseUrl}/api/v1/investments`, () =>
        HttpResponse.json(emptyInvestments),
      ),
      http.get(`${apiBaseUrl}/api/v1/debt`, () => HttpResponse.json(emptyDebt)),
      http.get(`${apiBaseUrl}/api/v1/goals`, () => HttpResponse.json(emptyGoals)),
    );
    renderWithProviders(<StoryScreen />);

    await waitFor(() =>
      expect(screen.getByText(/let's get connected/i)).toBeInTheDocument(),
    );
  });
});
