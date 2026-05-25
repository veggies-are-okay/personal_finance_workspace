import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api';
import { useApi } from './useApi';

describe('useApi', () => {
  it('starts loading then resolves to success with data', async () => {
    const { result } = renderHook(() => useApi(() => Promise.resolve({ n: 1 })));
    expect(result.current.phase).toBe('loading');
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(result.current.data).toEqual({ n: 1 });
  });

  it('resolves to not_connected when isEmpty returns true (DA-20)', async () => {
    const { result } = renderHook(() =>
      useApi(() => Promise.resolve({ rows: [] as number[] }), [], {
        isEmpty: (d) => d.rows.length === 0,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe('not_connected'));
  });

  it('maps a rejected ApiRequestError to the error phase with its message', async () => {
    const { result } = renderHook(() =>
      useApi(() => Promise.reject(new ApiRequestError(503, 'Database unavailable.'))),
    );
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toBe('Database unavailable.');
  });

  it('uses a generic message for non-Error rejections', async () => {
    const { result } = renderHook(() => useApi(() => Promise.reject('nope')));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toBe('Something went wrong.');
  });

  it('reload re-runs the fetcher', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useApi(fetcher));
    await waitFor(() => expect(result.current.phase).toBe('error'));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
