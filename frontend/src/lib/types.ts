/**
 * Wire types mirroring `contracts/openapi.canonical.json` (Appendix A).
 *
 * Conventions on the wire:
 * - money = a fixed 2dp decimal STRING (e.g. "123.45"); negative = money out.
 * - percentages/ratios = JSON NUMBER on a 0-100 scale (e.g. 26.0).
 * - dates = "YYYY-MM-DD"; months = "YYYY-MM"; datetimes = ISO-8601 UTC ("…Z").
 * - enums = lower_snake strings.
 * - lists paginate via { data, pagination{limit,offset,total} }.
 * - absent optional fields are OMITTED (never null).
 * - the canonical error envelope is { error: { code, message, details[] } }.
 *
 * These are structural mirrors only; the backends own the runtime contract.
 */

/** Monetary amount as a fixed 2dp decimal string. */
export type Money = string;
/** Percentage/ratio as a number 0-100. */
export type Percentage = number;
/** Calendar date, "YYYY-MM-DD". */
export type DateStr = string;
/** Year-month, "YYYY-MM". */
export type MonthStr = string;

export type Bucket = 'needs' | 'wants' | 'savings';
export type SourceMode = 'local' | 'api';
export type ItemStatus =
  | 'connected'
  | 'needs_reauth'
  | 'error'
  | 'disconnected'
  | 'not_connected';
export type LoanPriority = 'pay_first' | 'then' | 'minimums';
export type PayoffStrategy = 'avalanche' | 'minimums';

export interface ErrorDetail {
  field: string;
  location: string;
  message: string;
  code: string;
}
/** The one canonical error envelope shared by both backends. */
export interface ApiError {
  error: { code: string; message: string; details: ErrorDetail[] };
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}

export interface Transaction {
  date: DateStr;
  account: string;
  description: string;
  category?: string;
  bucket?: Bucket;
  amount: Money;
  is_recurring: boolean;
}
export interface PaginatedTransactions {
  data: Transaction[];
  pagination: Pagination;
}

export interface BudgetBucket {
  name: Bucket;
  target_pct: Percentage;
  actual_pct: Percentage;
  amount: Money;
}
export interface BudgetCategory {
  name: string;
  amount: Money;
  bucket: Bucket;
}
export interface MonthlyNeedsWants {
  month: MonthStr;
  needs: Money;
  wants: Money;
}
export interface RecurringCharge {
  merchant: string;
  category: string;
  cadence: string;
  last_charged: DateStr;
  monthly_est: Money;
}
export interface Budget {
  savings_rate: Percentage;
  effective_tax_rate: Percentage;
  buckets: BudgetBucket[];
  categories: BudgetCategory[];
  monthly: MonthlyNeedsWants[];
  recurring: RecurringCharge[];
}

export interface NetWorthSeriesPoint {
  month: MonthStr;
  retirement: Money;
  investments: Money;
  cash: Money;
}
export interface NetWorthAccount {
  name: string;
  type: string;
  balance: Money;
  delta_30d: Money;
}
export interface NetWorth {
  net_worth: Money;
  assets: Money;
  liabilities: Money;
  series: NetWorthSeriesPoint[];
  accounts: NetWorthAccount[];
}

export interface Allocation {
  class: string;
  target_pct: Percentage;
  actual_pct: Percentage;
  amount: Money;
}
export interface Concentration {
  holding: string;
  weight: Percentage;
}
export interface Holding {
  symbol: string;
  name: string;
  value: Money;
  weight: Percentage;
  gain: Money;
}
export interface Investments {
  portfolio_value: Money;
  unrealized_gain: Money;
  allocation: Allocation[];
  concentration: Concentration[];
  holdings: Holding[];
}

export interface DebtTranche {
  rate: Percentage;
  balance: Money;
  loan_count: number;
  priority: LoanPriority;
}
export interface PayoffProjection {
  strategy: PayoffStrategy;
  debt_free_year: number;
  total_interest: Money;
}
export interface Loan {
  name: string;
  balance: Money;
  rate: Percentage;
  minimum_payment: Money;
  priority: LoanPriority;
}
export interface Debt {
  total: Money;
  weighted_avg_rate: Percentage;
  monthly_minimum: Money;
  tranches: DebtTranche[];
  payoff: PayoffProjection[];
  loans: Loan[];
}

export interface GoalFunding {
  source: string;
  amount: Money;
}
export interface Affordability {
  price: Money;
  down_payment: Money;
  mortgage: Money;
  monthly_piti: Money;
  income_share: Percentage;
}
export interface Goals {
  target: Money;
  saved: Money;
  progress_pct: Percentage;
  funding: GoalFunding[];
  affordability: Affordability;
}
