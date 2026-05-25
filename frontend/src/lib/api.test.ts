import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiBaseUrl, getHealth } from './api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getHealth', () => {
  it('GETs ${base}/health and returns the parsed status', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await getHealth();

    // URL is built from the resolved base + /health.
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/health`,
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('throws when the backend responds with a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 503 }),
    );

    await expect(getHealth()).rejects.toThrow(/503/);
  });

  it('defaults to the local FastAPI port when no env override is set', () => {
    // In the test env VITE_API_BASE_URL is unset, so the default applies.
    expect(apiBaseUrl).toBe('http://localhost:8000');
  });

  it('resolves a RELATIVE base (/api, the Docker same-origin proxy) against the document origin', async () => {
    // The Docker frontend image builds with VITE_API_BASE_URL=/api so the app
    // calls same-origin. A relative base must not break `new URL()` — it is
    // resolved against window.location.origin.
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.resetModules();
    const { getHealth: getHealthRelative } = await import('./api');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await getHealthRelative();

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/api/health`,
      expect.anything(),
    );
  });
});
