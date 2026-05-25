/**
 * SYNTHETIC fixtures derived from the examples in
 * `contracts/openapi.canonical.json`. All values are made up — NO real
 * financial data (see `.claude/rules/data-privacy.md`). These back the MSW
 * mock so every screen renders with zero backend running.
 *
 * `empty*` fixtures model the DA-20 "not connected" state: a source that has
 * not been linked yet returns a structurally-valid-but-empty payload, which the
 * screens render as a friendly empty state rather than an error.
 */

import type {
  Budget,
  Debt,
  Goals,
  Investments,
  NetWorth,
  PaginatedTransactions,
} from '../lib/types';

function months(): string[] {
  // Twelve synthetic year-month labels ending at a fixed point.
  return [
    '2025-06',
    '2025-07',
    '2025-08',
    '2025-09',
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
  ];
}

export const budgetFixture: Budget = {
  savings_rate: 26.0,
  effective_tax_rate: 18.5,
  buckets: [
    { name: 'needs', target_pct: 50.0, actual_pct: 48.0, amount: '4400.00' },
    { name: 'wants', target_pct: 30.0, actual_pct: 31.0, amount: '2050.00' },
    { name: 'savings', target_pct: 20.0, actual_pct: 26.0, amount: '2400.00' },
  ],
  categories: [
    { name: 'housing', amount: '2200.00', bucket: 'needs' },
    { name: 'groceries', amount: '620.00', bucket: 'needs' },
    { name: 'transport', amount: '410.00', bucket: 'needs' },
    { name: 'dining', amount: '480.00', bucket: 'wants' },
    { name: 'shopping', amount: '360.00', bucket: 'wants' },
    { name: 'entertainment', amount: '210.00', bucket: 'wants' },
  ],
  monthly: months().map((month, i) => ({
    month,
    needs: (4200 + i * 18).toFixed(2),
    wants: (1900 + ((i * 37) % 400)).toFixed(2),
  })),
  recurring: [
    {
      merchant: 'Maple Property Mgmt',
      category: 'housing',
      cadence: 'monthly',
      last_charged: '2026-05-01',
      monthly_est: '2200.00',
    },
    {
      merchant: 'Streaming Co',
      category: 'entertainment',
      cadence: 'monthly',
      last_charged: '2026-05-12',
      monthly_est: '15.99',
    },
    {
      merchant: 'Fitness Studio',
      category: 'health',
      cadence: 'monthly',
      last_charged: '2026-05-08',
      monthly_est: '79.00',
    },
    {
      merchant: 'Cloud Backup',
      category: 'software',
      cadence: 'monthly',
      last_charged: '2026-05-03',
      monthly_est: '9.99',
    },
  ],
};

export const networthFixture: NetWorth = {
  net_worth: '312400.00',
  assets: '421300.00',
  liabilities: '108900.00',
  series: months().map((month, i) => ({
    month,
    retirement: (130000 + i * 2400).toFixed(2),
    investments: (78000 + i * 1500).toFixed(2),
    cash: (26000 + ((i * 700) % 5000)).toFixed(2),
  })),
  accounts: [
    { name: 'Individual Brokerage', type: 'investment', balance: '96200.00', delta_30d: '2940.00' },
    { name: 'Workplace 401(k)', type: 'retirement', balance: '171580.00', delta_30d: '4120.00' },
    { name: 'Rollover IRA', type: 'retirement', balance: '21800.00', delta_30d: '510.00' },
    { name: 'High-yield Savings', type: 'cash', balance: '38100.00', delta_30d: '430.00' },
    { name: 'Checking', type: 'cash', balance: '7320.00', delta_30d: '-410.00' },
    { name: 'Student Loans', type: 'liability', balance: '-108900.00', delta_30d: '520.00' },
  ],
};

export const investmentsFixture: Investments = {
  portfolio_value: '96200.00',
  unrealized_gain: '24400.00',
  allocation: [
    { class: 'equities', target_pct: 80.0, actual_pct: 82.0, amount: '78884.00' },
    { class: 'bonds', target_pct: 15.0, actual_pct: 12.0, amount: '11544.00' },
    { class: 'cash', target_pct: 5.0, actual_pct: 6.0, amount: '5772.00' },
  ],
  concentration: [
    { holding: 'BMKT', weight: 18.0 },
    { holding: 'LCAP', weight: 14.0 },
    { holding: 'TMKT', weight: 11.0 },
  ],
  holdings: [
    { symbol: 'BMKT', name: 'Broad Market Index ETF', value: '18800.00', weight: 20.0, gain: '5100.00' },
    { symbol: 'LCAP', name: 'Large-cap Index Fund', value: '13900.00', weight: 14.0, gain: '3200.00' },
    { symbol: 'TMKT', name: 'Total Market Index ETF', value: '14600.00', weight: 15.0, gain: '4100.00' },
    { symbol: 'INTL', name: 'International Index (hedged)', value: '9800.00', weight: 10.0, gain: '1200.00' },
    { symbol: 'BND', name: 'Aggregate Bond Index', value: '11544.00', weight: 12.0, gain: '-260.00' },
  ],
};

export const debtFixture: Debt = {
  total: '108900.00',
  weighted_avg_rate: 4.8,
  monthly_minimum: '504.00',
  tranches: [
    { rate: 6.8, balance: '42000.00', loan_count: 2, priority: 'pay_first' },
    { rate: 5.0, balance: '38900.00', loan_count: 2, priority: 'then' },
    { rate: 4.3, balance: '28000.00', loan_count: 1, priority: 'minimums' },
  ],
  payoff: [
    { strategy: 'avalanche', debt_free_year: 2031, total_interest: '14900.00' },
    { strategy: 'minimums', debt_free_year: 2036, total_interest: '22500.00' },
  ],
  loans: [
    { name: 'Grad PLUS — 2020', balance: '24500.00', rate: 6.8, minimum_payment: '150.00', priority: 'pay_first' },
    { name: 'Grad PLUS — 2019', balance: '17500.00', rate: 6.8, minimum_payment: '110.00', priority: 'pay_first' },
    { name: 'Unsubsidized — 2018', balance: '21500.00', rate: 5.0, minimum_payment: '120.00', priority: 'then' },
    { name: 'Subsidized — 2017', balance: '17400.00', rate: 5.0, minimum_payment: '64.00', priority: 'then' },
    { name: 'Subsidized — 2016', balance: '28000.00', rate: 4.3, minimum_payment: '60.00', priority: 'minimums' },
  ],
};

export const goalsFixture: Goals = {
  target: '180000.00',
  saved: '111600.00',
  progress_pct: 62.0,
  funding: [
    { source: 'High-yield Savings', amount: '38100.00' },
    { source: 'Brokerage (earmarked)', amount: '63500.00' },
    { source: 'Monthly contribution', amount: '4500.00' },
  ],
  affordability: {
    price: '900000.00',
    down_payment: '180000.00',
    mortgage: '720000.00',
    monthly_piti: '4850.00',
    income_share: 28.0,
  },
};

export const transactionsFixture: PaginatedTransactions = {
  data: [
    { date: '2026-05-20', account: 'Checking', description: 'Coffee Shop', category: 'dining', bucket: 'wants', amount: '-4.75', is_recurring: false },
    { date: '2026-05-19', account: 'Credit Card', description: 'Grocery Market', category: 'groceries', bucket: 'needs', amount: '-86.40', is_recurring: false },
    { date: '2026-05-18', account: 'Checking', description: 'Streaming Co', category: 'entertainment', bucket: 'wants', amount: '-15.99', is_recurring: true },
    { date: '2026-05-15', account: 'Checking', description: 'Acme Corp Payroll', category: 'income', amount: '4200.00', is_recurring: true },
    { date: '2026-05-14', account: 'Credit Card', description: 'Hardware Store', category: 'shopping', bucket: 'wants', amount: '-52.10', is_recurring: false },
  ],
  pagination: { limit: 50, offset: 0, total: 5 },
};

// --- Empty / not-connected variants (DA-20) ----------------------------------

export const emptyBudget: Budget = {
  savings_rate: 0,
  effective_tax_rate: 0,
  buckets: [],
  categories: [],
  monthly: [],
  recurring: [],
};
export const emptyNetworth: NetWorth = {
  net_worth: '0.00',
  assets: '0.00',
  liabilities: '0.00',
  series: [],
  accounts: [],
};
export const emptyInvestments: Investments = {
  portfolio_value: '0.00',
  unrealized_gain: '0.00',
  allocation: [],
  concentration: [],
  holdings: [],
};
export const emptyDebt: Debt = {
  total: '0.00',
  weighted_avg_rate: 0,
  monthly_minimum: '0.00',
  tranches: [],
  payoff: [],
  loans: [],
};
export const emptyGoals: Goals = {
  target: '0.00',
  saved: '0.00',
  progress_pct: 0,
  funding: [],
  affordability: {
    price: '0.00',
    down_payment: '0.00',
    mortgage: '0.00',
    monthly_piti: '0.00',
    income_share: 0,
  },
};
export const emptyTransactions: PaginatedTransactions = {
  data: [],
  pagination: { limit: 50, offset: 0, total: 0 },
};
