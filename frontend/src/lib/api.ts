/**
 * API client — the single network boundary for the frontend.
 *
 * The app is backend-NEUTRAL: it talks to whichever backend
 * `VITE_API_BASE_URL` points at (FastAPI on :8000 or NestJS on :3000), and in
 * development it talks to an MSW mock derived from `contracts/openapi.canonical.json`.
 * Keep all `fetch` calls in this module so tests can mock exactly one boundary.
 *
 * Wire conventions follow Appendix A — see `./types.ts`.
 */

import type {
  ApiError,
  Budget,
  Debt,
  Goals,
  Investments,
  NetWorth,
  PaginatedTransactions,
} from './types';

/** Default base URL when `VITE_API_BASE_URL` is not set. */
const DEFAULT_API_BASE_URL = 'http://localhost:8000';

/** Resolved backend base URL (no trailing slash). */
export const apiBaseUrl: string = (
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/+$/, '');

/** Shape of the canonical `GET /health` response body. */
export interface HealthResponse {
  status: string;
}

/**
 * An error thrown for non-2xx responses. Carries the parsed canonical error
 * envelope when the backend returned one, so screens can show a precise message.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body?: ApiError;

  constructor(status: number, message: string, body?: ApiError) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

const JSON_HEADERS = { Accept: 'application/json' } as const;

/** Build `${base}${path}` with an optional query string. */
function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(`${apiBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

/**
 * GET `path` and parse the JSON body as `T`.
 *
 * @throws {ApiRequestError} when the response is not OK (non-2xx). The canonical
 *   error envelope is attached as `.body` when the backend returned one.
 */
async function getJson<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const response = await fetch(buildUrl(path, query), { headers: JSON_HEADERS });

  if (!response.ok) {
    let body: ApiError | undefined;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      body = undefined;
    }
    const message =
      body?.error?.message ?? `Request to ${path} failed (HTTP ${response.status}).`;
    throw new ApiRequestError(response.status, message, body);
  }

  return (await response.json()) as T;
}

/** GET `${base}/health`. @throws {ApiRequestError} on non-2xx. */
export async function getHealth(): Promise<HealthResponse> {
  const body = await getJson<HealthResponse>('/health');
  return { status: body.status };
}

/** Query parameters accepted by `GET /api/v1/transactions`. */
export interface TransactionsQuery {
  limit?: number;
  offset?: number;
  date_from?: string;
  date_to?: string;
  account?: string;
  category?: string;
  q?: string;
}

/** GET `/api/v1/transactions` (paginated). */
export function getTransactions(
  query: TransactionsQuery = {},
): Promise<PaginatedTransactions> {
  return getJson<PaginatedTransactions>('/api/v1/transactions', {
    limit: query.limit?.toString(),
    offset: query.offset?.toString(),
    date_from: query.date_from,
    date_to: query.date_to,
    account: query.account,
    category: query.category,
    q: query.q,
  });
}

/** GET `/api/v1/budget`. */
export function getBudget(window?: string): Promise<Budget> {
  return getJson<Budget>('/api/v1/budget', { window });
}

/** GET `/api/v1/networth`. */
export function getNetworth(window?: string): Promise<NetWorth> {
  return getJson<NetWorth>('/api/v1/networth', { window });
}

/** GET `/api/v1/investments`. */
export function getInvestments(): Promise<Investments> {
  return getJson<Investments>('/api/v1/investments');
}

/** GET `/api/v1/debt`. */
export function getDebt(strategy?: string): Promise<Debt> {
  return getJson<Debt>('/api/v1/debt', { strategy });
}

/** GET `/api/v1/goals`. */
export function getGoals(): Promise<Goals> {
  return getJson<Goals>('/api/v1/goals');
}
