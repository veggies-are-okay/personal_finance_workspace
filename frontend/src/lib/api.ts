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
  ConnectionsList,
  Debt,
  ExchangeRequest,
  ExchangeResponse,
  Goals,
  Investments,
  LinkTokenCreateRequest,
  LinkTokenResponse,
  NetWorth,
  PaginatedTransactions,
  Source,
  SourceMode,
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
const JSON_BODY_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
} as const;

/**
 * Build `${base}${path}` with an optional query string.
 *
 * `apiBaseUrl` may be ABSOLUTE (`http://localhost:8000`, dev pointing straight
 * at a backend) or RELATIVE (`/api`, the Docker same-origin nginx-proxy model).
 * `new URL()` requires an absolute URL, so for a relative base we resolve it
 * against the current document origin (`window.location.origin`).
 */
function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const target = `${apiBaseUrl}${path}`;
  const base =
    typeof window !== 'undefined' && target.startsWith('/')
      ? window.location.origin
      : undefined;
  const url = new URL(target, base);
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

/**
 * POST `path` with a JSON `body` and parse the JSON response as `T`.
 *
 * @throws {ApiRequestError} when the response is not OK (non-2xx). The canonical
 *   error envelope is attached as `.body` when the backend returned one.
 */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: JSON_BODY_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = (await response.json()) as ApiError;
    } catch {
      error = undefined;
    }
    const message =
      error?.error?.message ?? `Request to ${path} failed (HTTP ${response.status}).`;
    throw new ApiRequestError(response.status, message, error);
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

// --- Connections (Plaid Link lifecycle + Settings) ---------------------------
// These three endpoints are P6.1 on the backend; until then the frontend drives
// them against the MSW mock derived from the canonical spec (DA-21).

/** GET `/api/v1/connections` — per-source mode/status, drives the Settings screen. */
export function getConnections(): Promise<ConnectionsList> {
  return getJson<ConnectionsList>('/api/v1/connections');
}

/** POST `/api/v1/connections/link-token` — create a short-lived Plaid Link token. */
export function createLinkToken(
  body: LinkTokenCreateRequest = {},
): Promise<LinkTokenResponse> {
  return postJson<LinkTokenResponse>('/api/v1/connections/link-token', body);
}

/** POST `/api/v1/connections/exchange` — swap a Plaid `public_token` for an Item. */
export function exchangePublicToken(public_token: string): Promise<ExchangeResponse> {
  const body: ExchangeRequest = { public_token };
  return postJson<ExchangeResponse>('/api/v1/connections/exchange', body);
}

/**
 * Switch a single source between `local` and `api` mode.
 *
 * NOTE: the canonical contract has no mode-mutation endpoint yet — wiring the
 * adapter swap end-to-end is P6.4 (`BE`). For now this is a FRONTEND-ONLY call
 * against the MSW mock at a connections-namespaced path so the Settings toggle
 * is exercisable; it is intentionally NOT in `contracts/openapi.canonical.json`.
 */
export function setSourceMode(
  source: Source,
  mode: SourceMode,
): Promise<ConnectionsList> {
  return postJson<ConnectionsList>('/api/v1/connections/source-mode', { source, mode });
}
