/**
 * MSW Node server — intercepts `fetch` in the Vitest (jsdom) test run so screen
 * tests exercise the real API client against the contract-derived mock. Tests
 * override individual handlers with `server.use(...)` to drive empty/error states.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
