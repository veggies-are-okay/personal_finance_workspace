import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

/**
 * Start the MSW mock before rendering when no real backend is configured (or
 * when `VITE_USE_MOCK=true` is forced). When `VITE_API_BASE_URL` is set, the
 * mock stays off and the same API client hits the live backend (DA-21 wiring).
 */
async function enableMocking(): Promise<void> {
  const forceMock = import.meta.env.VITE_USE_MOCK === 'true';
  const hasBackend = Boolean(import.meta.env.VITE_API_BASE_URL);
  const useMock = forceMock || (import.meta.env.DEV && !hasBackend);
  if (!useMock) return;

  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
