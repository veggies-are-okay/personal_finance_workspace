/**
 * Display metadata for the Settings / Data Sources screen.
 *
 * Maps each `source` to its human label, what it powers, the Phase-1 local file,
 * and the Plaid products to request when linking it (Local↔API swap is P6.4 on
 * the backend; the products here drive the Link token request). Maps each
 * `item_status` to its label, badge tone, and the affordance the card should
 * offer — `needs_reauth`/`error` get a **Reconnect** CTA (Plaid update mode,
 * DA-13), `not_connected` gets **Connect**, `connected` is a managed state.
 */

import type { BadgeTone } from '../../components/Badge';
import type { ItemStatus, PlaidProduct, Source } from '../../lib/types';

export interface SourceMeta {
  label: string;
  /** What this source powers, shown under the title. */
  purpose: string;
  /** Phase-1 local flat file (the "Local file" column). */
  localFile: string;
  /** Live provider name (the "Live API" column). */
  provider: string;
  /** Plaid products requested when linking this source. */
  products: PlaidProduct[];
}

export const SOURCE_META: Record<Source, SourceMeta> = {
  transactions: {
    label: 'Bank & card transactions',
    purpose: 'Powers Budget, spending, and recurring charges.',
    localFile: 'docs/bank_statements/*.csv',
    provider: 'Plaid · Transactions',
    products: ['transactions'],
  },
  income: {
    label: 'Pay stubs & income',
    purpose: 'Powers savings rate and effective tax rate.',
    localFile: 'docs/paystubs/paystubs.csv',
    provider: 'Plaid · Income',
    products: ['income'],
  },
  holdings: {
    label: 'Brokerage holdings',
    purpose: 'Powers Investments allocation and concentration.',
    localFile: 'docs/etrade_stocks_portfolio.csv',
    provider: 'Plaid · Investments',
    products: ['investments'],
  },
  loans: {
    label: 'Student loans',
    purpose: 'Powers Debt tranches and payoff projections.',
    localFile: 'docs/loans.csv',
    provider: 'Plaid · Liabilities',
    products: ['liabilities'],
  },
  listings: {
    label: 'Real-estate comps',
    purpose: 'Powers the home-affordability target on Goals.',
    localFile: '— (manual target)',
    provider: 'RentCast',
    products: [],
  },
};

/** Which affordance a source card should present for a given status. */
export type StatusAffordance = 'connect' | 'reconnect' | 'manage' | 'none';

export interface StatusMeta {
  label: string;
  tone: BadgeTone;
  affordance: StatusAffordance;
}

export const STATUS_META: Record<ItemStatus, StatusMeta> = {
  connected: { label: 'Connected', tone: 'positive', affordance: 'manage' },
  needs_reauth: { label: 'Needs reconnect', tone: 'warn', affordance: 'reconnect' },
  error: { label: 'Sync error', tone: 'warn', affordance: 'reconnect' },
  disconnected: { label: 'Disconnected', tone: 'neutral', affordance: 'connect' },
  not_connected: { label: 'Not connected', tone: 'neutral', affordance: 'connect' },
};
