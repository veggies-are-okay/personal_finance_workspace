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
import type { ExchangeResponse, Source, SourceMode } from '../lib/types';
import {
  budgetFixture,
  connectionsFixture,
  debtFixture,
  emptyBudget,
  emptyConnections,
  emptyDebt,
  emptyGoals,
  emptyInvestments,
  emptyNetworth,
  emptyTransactions,
  goalsFixture,
  investmentsFixture,
  linkTokenFixture,
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

/** Map a connected/error-status row back to an `item_status` after a Plaid run. */
const EXCHANGE_RESULT: ExchangeResponse = {
  item_id: 'item-synthetic-001',
  status: 'connected',
};

export const handlers = [
  http.get(`${apiBaseUrl}/health`, () => HttpResponse.json({ status: 'ok' })),
  viewHandler('/api/v1/transactions', transactionsFixture, emptyTransactions),
  viewHandler('/api/v1/budget', budgetFixture, emptyBudget),
  viewHandler('/api/v1/networth', networthFixture, emptyNetworth),
  viewHandler('/api/v1/investments', investmentsFixture, emptyInvestments),
  viewHandler('/api/v1/debt', debtFixture, emptyDebt),
  viewHandler('/api/v1/goals', goalsFixture, emptyGoals),

  // --- Connections (P6.1 backend; mocked here per DA-21) ---------------------
  viewHandler('/api/v1/connections', connectionsFixture, emptyConnections),
  http.post(`${apiBaseUrl}/api/v1/connections/link-token`, () =>
    HttpResponse.json(linkTokenFixture),
  ),
  http.post(`${apiBaseUrl}/api/v1/connections/exchange`, () =>
    HttpResponse.json(EXCHANGE_RESULT),
  ),
  // Mock-only (NOT canonical): the Local↔API toggle target until P6.4 wires the
  // adapter swap. Echoes a snapshot with the one source flipped to the new mode.
  http.post(`${apiBaseUrl}/api/v1/connections/source-mode`, async ({ request }) => {
    const { source, mode } = (await request.json()) as {
      source: Source;
      mode: SourceMode;
    };
    return HttpResponse.json({
      ...connectionsFixture,
      sources: connectionsFixture.sources.map((row) =>
        row.source === source ? { ...row, mode } : row,
      ),
    });
  }),

  // --- Ingest (Python-only P8.1; mocked so the upload UI is demoable in dev) --
  // Reads the multipart body and echoes a per-file summary. `?scenario=error`
  // returns the canonical 422 a bad/empty/unknown upload would produce.
  http.post(`${apiBaseUrl}/api/v1/ingest/:source`, async ({ params, request }) => {
    if (scenarioOf(request) === 'error') {
      return HttpResponse.json(
        {
          error: {
            code: 'UNPROCESSABLE_ENTITY',
            message: 'Could not detect a known bank format for the uploaded file.',
            details: [],
          },
        },
        { status: 422 },
      );
    }
    const source = String(params.source);
    const form = await request.formData();
    const uploaded = form.getAll('file').filter((f): f is File => f instanceof File);
    const detected = INGEST_DETECTED_TYPE[source] ?? 'detected';
    const files = uploaded.map((f, i) => ({
      filename: f.name,
      detected_type: detected,
      rows: 12 + i,
    }));
    const total_rows = files.reduce((sum, f) => sum + f.rows, 0);
    return HttpResponse.json({ source, files, total_rows });
  }),
];

/** Synthetic detected-type per ingest source, mirroring the backend's labels. */
const INGEST_DETECTED_TYPE: Record<string, string> = {
  transactions: 'amex',
  income: 'paystubs_csv',
  holdings: 'etrade_csv',
  accounts: 'accounts_yaml',
  loans: 'loan_csv',
};
