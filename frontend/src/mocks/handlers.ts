/**
 * MSW request handlers — the mock backend derived from
 * `contracts/openapi.canonical.json`. They let the frontend render every screen
 * with zero backend running, and they are reused by the Vitest test suite.
 *
 * The same typed API client (`src/lib/api.ts`) talks to these handlers in dev
 * and to a real FastAPI/NestJS backend when `VITE_API_BASE_URL` is set, so the
 * mock is a faithful structural stand-in (Appendix A wire conventions).
 *
 * Scenario control (mock-only, never reaches a real backend): a `?scenario=`
 * query toggles the response so loading/empty/error states are demonstrable:
 *   - (default)         → populated synthetic fixtures
 *   - `?scenario=empty` → DA-20 not-connected empty payloads
 *   - `?scenario=error` → HTTP 503 with the canonical error envelope
 */

import { http, HttpResponse } from 'msw';
import { apiBaseUrl } from '../lib/api';
import {
  budgetFixture,
  debtFixture,
  emptyBudget,
  emptyDebt,
  emptyGoals,
  emptyInvestments,
  emptyNetworth,
  emptyTransactions,
  goalsFixture,
  investmentsFixture,
  networthFixture,
  transactionsFixture,
} from './fixtures';

const SERVICE_UNAVAILABLE = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Database unavailable.',
    details: [],
  },
};

type Scenario = 'default' | 'empty' | 'error';

function scenarioOf(request: Request): Scenario {
  const value = new URL(request.url).searchParams.get('scenario');
  if (value === 'empty') return 'empty';
  if (value === 'error') return 'error';
  return 'default';
}

/**
 * Build a GET handler that returns `populated` normally, the `empty` payload for
 * `?scenario=empty`, and a canonical 503 for `?scenario=error`.
 */
function viewHandler<T>(path: string, populated: T, empty: T) {
  return http.get(`${apiBaseUrl}${path}`, ({ request }) => {
    const scenario = scenarioOf(request);
    if (scenario === 'error') {
      return HttpResponse.json(SERVICE_UNAVAILABLE, { status: 503 });
    }
    // Fixtures are plain JSON objects; cast to the JSON body type MSW expects.
    const body = (scenario === 'empty' ? empty : populated) as Record<string, unknown>;
    return HttpResponse.json(body);
  });
}

export const handlers = [
  http.get(`${apiBaseUrl}/health`, () => HttpResponse.json({ status: 'ok' })),
  viewHandler('/api/v1/transactions', transactionsFixture, emptyTransactions),
  viewHandler('/api/v1/budget', budgetFixture, emptyBudget),
  viewHandler('/api/v1/networth', networthFixture, emptyNetworth),
  viewHandler('/api/v1/investments', investmentsFixture, emptyInvestments),
  viewHandler('/api/v1/debt', debtFixture, emptyDebt),
  viewHandler('/api/v1/goals', goalsFixture, emptyGoals),
];
