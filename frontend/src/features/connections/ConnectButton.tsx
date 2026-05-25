/**
 * The per-source Connect / Reconnect CTA. Owns one `usePlaidConnect` flow and
 * renders the right label + busy/error state for the source's status.
 *
 * - `not_connected` / `disconnected` → "Connect" (primary)
 * - `needs_reauth` / `error`         → "Reconnect" (Plaid update mode, DA-13)
 * - `connected`                      → no CTA (managed elsewhere)
 *
 * The actual Plaid widget is opened by `usePlaidConnect`; in tests/dev that hook
 * is mocked so no real Plaid Link opens (DATA PRIVACY — no credentials/tokens).
 */

import type { StatusAffordance } from './sourceMeta';
import type { PlaidProduct } from '../../lib/types';
import { usePlaidConnect } from './usePlaidConnect';

const CONNECT_BUSY_LABEL = 'Connecting…';

export function ConnectButton({
  affordance,
  products,
  onConnected,
}: {
  affordance: StatusAffordance;
  products: PlaidProduct[];
  onConnected?: () => void;
}) {
  const { connect, busy, phase, error } = usePlaidConnect(products, onConnected);

  if (affordance === 'manage' || affordance === 'none') return null;

  const isReconnect = affordance === 'reconnect';
  const idleLabel = isReconnect ? 'Reconnect' : 'Connect';
  const label = busy ? CONNECT_BUSY_LABEL : idleLabel;

  // Reconnect (update mode) reads as a recovery action; Connect is the primary.
  const buttonClass = isReconnect
    ? 'inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:border-amber-800 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/30'
    : 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        aria-busy={busy}
        className={buttonClass}
      >
        {busy && (
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
          />
        )}
        {label}
      </button>
      {phase === 'error' && error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
