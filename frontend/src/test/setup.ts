import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from '../mocks/server';

// jsdom in this setup does not provide a working localStorage or matchMedia;
// the ThemeProvider needs both. Provide minimal in-memory implementations.
if (!('localStorage' in window) || typeof window.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

// Start the MSW Node server so screen tests exercise the real API client
// against the contract-derived mock. `bypass` lets the api.ts unit tests that
// stub `globalThis.fetch` directly keep working without an unhandled-request error.
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));

// Ensure the DOM is reset and per-test handler overrides are cleared between tests.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
