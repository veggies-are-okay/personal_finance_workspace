/**
 * `usePlaidConnect` — the isolated Plaid Link flow for one source.
 *
 * Lifecycle (see `docs/2026-05-24-data-connectors-and-frontend-design.md`):
 *   1. `connect()` → POST /connections/link-token → receive a short-lived token
 *   2. open Plaid Link with that token (real widget in prod; MOCKED in tests/dev)
 *   3. on `onSuccess(public_token)` → POST /connections/exchange
 *   4. surface `phase` so the UI can show pending / done / error
 *
 * `react-plaid-link`'s `usePlaidLink` is the only Plaid coupling, and it lives
 * behind this hook so the rest of the app never imports Plaid directly. Tests
 * mock `usePlaidLink` (no real Plaid Link, no credentials — DATA PRIVACY).
 *
 * A `connected`/healthy source uses standard Link; a `needs_reauth`/`error`
 * source uses Plaid **update mode** (DA-13) — same token request, same
 * exchange-free reconnect path; we model both with one flow and let the backend
 * decide the token type.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  usePlaidLink,
  type PlaidLinkOnSuccess,
  type PlaidLinkOptions,
} from 'react-plaid-link';
import { createLinkToken, exchangePublicToken } from '../../lib/api';
import { ApiRequestError } from '../../lib/api';
import type { ItemStatus, PlaidProduct } from '../../lib/types';

export type ConnectPhase =
  | 'idle'
  | 'creating_token' // requesting a link token
  | 'linking' // Plaid Link widget open
  | 'exchanging' // swapping public_token for an Item
  | 'done'
  | 'error';

export interface UsePlaidConnect {
  phase: ConnectPhase;
  /** Last error message, when `phase === 'error'`. */
  error?: string;
  /** The `item_status` returned by the exchange, when `phase === 'done'`. */
  resultStatus?: ItemStatus;
  /** True while the link token / Link widget is initialising. */
  busy: boolean;
  /** Kick off the link-token → open → exchange flow. */
  connect: () => void;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Could not connect this source.';
}

/**
 * @param products Plaid products to request for this source's Link session.
 * @param onConnected called after a successful exchange so the screen can refresh.
 */
export function usePlaidConnect(
  products: PlaidProduct[],
  onConnected?: () => void,
): UsePlaidConnect {
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [error, setError] = useState<string | undefined>();
  const [resultStatus, setResultStatus] = useState<ItemStatus | undefined>();
  const [token, setToken] = useState<string | null>(null);
  // `open()` must be called after the Link instance is `ready`; we stash the
  // request in a ref so the readiness effect below can fire it exactly once.
  const wantsOpen = useRef(false);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken) => {
      setPhase('exchanging');
      exchangePublicToken(publicToken)
        .then((res) => {
          setResultStatus(res.status);
          setPhase('done');
          onConnected?.();
        })
        .catch((err: unknown) => {
          setError(messageOf(err));
          setPhase('error');
        });
    },
    [onConnected],
  );

  const config: PlaidLinkOptions = {
    token,
    onSuccess,
    onExit: (err) => {
      // User dismissed Link, or Plaid surfaced an error before exit.
      if (err) {
        setError(err.display_message ?? err.error_message ?? 'Plaid Link exited.');
        setPhase('error');
      } else if (phase === 'linking') {
        setPhase('idle');
      }
    },
  };

  const { open, ready } = usePlaidLink(config);

  // Open Link as soon as it is `ready` and a connect() call asked for it. Using
  // an effect (not a render-time call) keeps `open()` out of render.
  useEffect(() => {
    if (wantsOpen.current && ready && token) {
      wantsOpen.current = false;
      setPhase('linking');
      open();
    }
  }, [ready, token, open]);

  const connect = useCallback(() => {
    setError(undefined);
    setResultStatus(undefined);
    setPhase('creating_token');
    createLinkToken({ products })
      .then((res) => {
        wantsOpen.current = true;
        setToken(res.link_token);
      })
      .catch((err: unknown) => {
        setError(messageOf(err));
        setPhase('error');
      });
  }, [products]);

  const busy = phase === 'creating_token' || phase === 'linking' || phase === 'exchanging';

  return { phase, error, resultStatus, busy, connect };
}
