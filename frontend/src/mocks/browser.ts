/**
 * MSW browser worker — runs in development so the app renders against the
 * contract-derived mock with no backend. Started conditionally from `main.tsx`
 * when `VITE_USE_MOCK` is enabled (default in dev).
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
