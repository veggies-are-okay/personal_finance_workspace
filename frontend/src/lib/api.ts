/**
 * API client — the single network boundary for the frontend.
 *
 * The app is backend-NEUTRAL: it talks to whichever backend
 * `VITE_API_BASE_URL` points at (FastAPI on :8000 or NestJS on :3000;
 * both serve the identical `GET /health` contract). Keep all `fetch`
 * calls in this module so tests can mock exactly one boundary.
 */

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
 * GET `${base}/health` and return the parsed `{ status }` body.
 *
 * @throws Error if the response is not OK (non-2xx).
 */
export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/health`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  const body = (await response.json()) as HealthResponse;
  return { status: body.status };
}
