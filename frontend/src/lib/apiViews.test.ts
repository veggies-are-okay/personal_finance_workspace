import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import {
  ApiRequestError,
  apiBaseUrl,
  getBudget,
  getDebt,
  getGoals,
  getInvestments,
  getNetworth,
  getTransactions,
} from './api';

describe('view endpoint clients (against the contract mock)', () => {
  it('getBudget returns the budget payload with money strings and number percentages', async () => {
    const budget = await getBudget('12m');
    expect(typeof budget.savings_rate).toBe('number');
    expect(budget.buckets[0].amount).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('getNetworth, getInvestments, getDebt, getGoals all resolve from the mock', async () => {
    const [nw, inv, debt, goals] = await Promise.all([
      getNetworth('12m'),
      getInvestments(),
      getDebt('avalanche'),
      getGoals(),
    ]);
    expect(nw.accounts.length).toBeGreaterThan(0);
    expect(inv.holdings.length).toBeGreaterThan(0);
    expect(debt.loans.length).toBeGreaterThan(0);
    expect(goals.funding.length).toBeGreaterThan(0);
  });

  it('getTransactions forwards query params and returns the paginated envelope', async () => {
    let seenUrl = '';
    server.use(
      http.get(`${apiBaseUrl}/api/v1/transactions`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({
          data: [],
          pagination: { limit: 25, offset: 50, total: 0 },
        });
      }),
    );

    const page = await getTransactions({ limit: 25, offset: 50, q: 'coffee' });
    expect(page.pagination.limit).toBe(25);
    expect(seenUrl).toContain('limit=25');
    expect(seenUrl).toContain('offset=50');
    expect(seenUrl).toContain('q=coffee');
  });

  it('throws ApiRequestError carrying the canonical envelope on 503', async () => {
    server.use(
      http.get(`${apiBaseUrl}/api/v1/budget`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Database unavailable.',
              details: [],
            },
          },
          { status: 503 },
        ),
      ),
    );

    await expect(getBudget()).rejects.toBeInstanceOf(ApiRequestError);
    await expect(getBudget()).rejects.toThrow(/Database unavailable/);
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    server.use(
      http.get(`${apiBaseUrl}/api/v1/goals`, () =>
        HttpResponse.text('boom', { status: 500 }),
      ),
    );
    await expect(getGoals()).rejects.toThrow(/HTTP 500/);
  });
});
