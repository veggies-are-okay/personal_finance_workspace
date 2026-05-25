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
import type { IngestSource, ItemStatus, PlaidProduct, Source } from '../../lib/types';

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

// --- File-upload metadata (P8.2; Python-only ingest) -------------------------
// Each entry drives one upload control: the `<input accept>` filter, whether
// multiple files are allowed, and a copy hint. The label/purpose come from
// SOURCE_META where the source is also a connections source; `accounts` is
// upload-only (it powers Net Worth via a YAML snapshot, not a Plaid product).

export interface UploadMeta {
  /** Human label for this upload control. */
  label: string;
  /** What the uploaded file powers, shown under the control. */
  purpose: string;
  /** `accept` attribute for the file input (extensions the backend handles). */
  accept: string;
  /** Whether multiple files may be selected and ingested in one request. */
  multiple: boolean;
  /** Short hint describing the expected file(s). */
  hint: string;
}

export const UPLOAD_META: Record<IngestSource, UploadMeta> = {
  transactions: {
    label: 'Bank & card transactions',
    purpose: 'Loads Budget, spending, and recurring charges.',
    accept: '.csv,.pdf',
    multiple: true,
    hint: 'Drop bank/card CSV exports and Chase PDF statements (multiple allowed).',
  },
  income: {
    label: 'Pay stubs & income',
    purpose: 'Loads savings rate and effective tax rate.',
    accept: '.pdf,.csv',
    multiple: true,
    hint: 'Drop pay-stub PDF(s) or a paystubs.csv (multiple allowed).',
  },
  holdings: {
    label: 'Brokerage holdings',
    purpose: 'Loads Investments allocation and concentration.',
    accept: '.csv',
    multiple: false,
    hint: 'Drop an E*TRADE positions CSV.',
  },
  accounts: {
    label: 'Account balances',
    purpose: 'Loads cash & account balances into Net Worth.',
    accept: '.yaml,.yml',
    multiple: false,
    hint: 'Drop an accounts.yaml snapshot.',
  },
  loans: {
    label: 'Student loans',
    purpose: 'Loads Debt tranches and payoff projections.',
    accept: '.csv',
    multiple: false,
    hint: 'Drop a loan balances CSV.',
  },
};

/**
 * Map a connections `Source` to its ingest `Source`, or `null` when the source
 * has no file-upload path (e.g. `listings` — a manual target, no ingest route).
 * Note `accounts` is an ingest source with no connections row, so it is offered
 * as a standalone upload card rather than mapped here.
 */
export const SOURCE_TO_INGEST: Record<Source, IngestSource | null> = {
  transactions: 'transactions',
  income: 'income',
  holdings: 'holdings',
  loans: 'loans',
  listings: null,
};
