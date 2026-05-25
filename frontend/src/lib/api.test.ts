import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiBaseUrl, getHealth, ingestSource, ApiRequestError } from './api';

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

describe('ingestSource', () => {
  it('POSTs multipart FormData to /api/v1/ingest/{source} without a Content-Type header', async () => {
    const summary = {
      source: 'transactions',
      files: [{ filename: 'amex.csv', detected_type: 'amex', rows: 12 }],
      total_rows: 12,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const file = new File(['Date,Description,Amount\n'], 'amex.csv', { type: 'text/csv' });
    const result = await ingestSource('transactions', [file]);

    expect(result).toEqual(summary);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${apiBaseUrl}/api/v1/ingest/transactions`);
    expect((init as RequestInit).method).toBe('POST');

    // The body is a FormData carrying the file under the `file` field.
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const sent = body.getAll('file');
    expect(sent).toHaveLength(1);
    expect((sent[0] as File).name).toBe('amex.csv');

    // We must NOT set Content-Type — the browser sets the multipart boundary.
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Content-Type');
  });

  it('appends every file when multiple are uploaded', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ source: 'income', files: [], total_rows: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const files = [
      new File(['a'], 'stub1.pdf', { type: 'application/pdf' }),
      new File(['b'], 'stub2.pdf', { type: 'application/pdf' }),
    ];
    await ingestSource('income', files);

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.getAll('file')).toHaveLength(2);
  });

  it('maps a canonical 422 envelope onto an ApiRequestError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'UNPROCESSABLE_ENTITY', message: 'Could not detect a known bank format.', details: [] },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const file = new File(['garbage'], 'mystery.csv', { type: 'text/csv' });
    await expect(ingestSource('transactions', [file])).rejects.toMatchObject({
      status: 422,
      message: /could not detect a known bank format/i,
    });
  });

  it('falls back to a generic message when the body is not the canonical envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    const file = new File(['x'], 'loans.csv', { type: 'text/csv' });
    const err = await ingestSource('loans', [file]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(503);
    expect((err as ApiRequestError).message).toMatch(/loans failed \(HTTP 503\)/i);
  });
});
