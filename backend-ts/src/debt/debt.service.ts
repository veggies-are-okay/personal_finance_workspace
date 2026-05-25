import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoanEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { formatMoney } from '../transactions/transactions.service';
import {
  DebtDto,
  DebtTrancheDto,
  LoanDto,
  PayoffProjectionDto,
} from './debt-response.dto';

/**
 * Thin read of the `loans` table (parity twin of the FastAPI `build_debt`). The
 * endpoint composes the design §3 Debt shape: totals, the balance-weighted
 * average rate, rate tranches, and BOTH payoff projections (avalanche
 * highest-rate-first acceleration vs minimums-only). No row is recomputed; both
 * backends read the SAME rows, so for the same DB state they return
 * byte-identical bodies (DA-9).
 *
 * The payoff projection (`projectPayoff`) is an INTEGER-CENT month-by-month
 * amortization that mirrors the Python `project_payoff` exactly (same accrual
 * order, same half-up rounding, same horizon cap), so the projected
 * `debt_free_year` + `total_interest` match FastAPI to the cent.
 *
 * Money is a 2dp decimal STRING (DA-2); rates are JSON NUMBERS 0-100 (DA-22);
 * `loan_priority`/`payoff_strategy` are the lower_snake registry values. An
 * empty table yields zeros + empty arrays + two zero projections. A DB failure
 * becomes the same canonical 503 FastAPI returns (DA-18).
 */

/** A horizon cap so a non-amortizing loan terminates deterministically (50yr). */
const MAX_MONTHS = 600;
/** Reference start month for translating a payoff month count into a year. */
const BASE_YEAR = 2026;
const BASE_MONTH = 1; // January 2026

/** Canonical priority ordering for deterministic tranche ordering. */
const PRIORITY_ORDER: Record<string, number> = {
  pay_first: 0,
  then: 1,
  minimums: 2,
};

/** A loan reduced to the integer-cent / scaled-rate form the simulator uses. */
interface SimLoan {
  name: string;
  balanceCents: number;
  minimumCents: number;
  /** annual rate * 10, as an integer (e.g. 6.8% -> 68) to keep math exact. */
  rateTenths: number;
}

/** Round a non-negative rational `num/den` to the nearest integer, half-up. */
export function roundHalfUp(num: number, den: number): number {
  // num, den are non-negative integers; mirrors Python Decimal ROUND_HALF_UP.
  const q = Math.floor(num / den);
  const r = num - q * den;
  return r * 2 >= den ? q + 1 : q;
}

/** Parse a decimal-string dollar amount into integer cents (half-up). */
export function toCents(value: string): number {
  const negative = value.trim().startsWith('-');
  const unsigned = value.trim().replace(/^[-+]/, '');
  const [intPart, fracRaw = ''] = unsigned.split('.');
  const whole = Number(intPart || '0');
  // Round any sub-cent fraction half-up to 2 dp.
  const frac3 = (fracRaw + '000').slice(0, 3);
  let cents = whole * 100 + Number(frac3.slice(0, 2));
  if (Number(frac3[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

/** Render integer cents as a fixed-2dp decimal string (parity with FastAPI). */
function centsToMoney(cents: number): string {
  return formatMoney((cents / 100).toFixed(2));
}

/** Translate a payoff month count into the calendar year the debt is cleared. */
export function monthsToYear(months: number): number {
  if (months <= 0) return 0;
  const zeroBased = BASE_MONTH - 1 + (months - 1);
  return BASE_YEAR + Math.floor(zeroBased / 12);
}

/**
 * Simulate paying off `loans` month-by-month in integer cents. Returns
 * `[months, totalInterestCents]`. Deterministic and byte-identical to the
 * Python `project_payoff`:
 *  - `accelerate=false` (minimums): each loan pays exactly its minimum;
 *  - `accelerate=true` (avalanche): budget = sum of original minimums; minimums
 *    paid on all, then the leftover (incl. freed minimums) is thrown entirely at
 *    the highest-rate outstanding loan first.
 * Interest accrues monthly (half-up to a cent) BEFORE the payment is applied.
 */
export function projectPayoff(
  loans: SimLoan[],
  accelerate: boolean,
): [number, number] {
  // Highest-rate-first order (tie-break by name) for avalanche targeting.
  const order = loans
    .map((_, i) => i)
    .sort((a, b) => {
      if (loans[b].rateTenths !== loans[a].rateTenths) {
        return loans[b].rateTenths - loans[a].rateTenths;
      }
      return loans[a].name < loans[b].name ? -1 : 1;
    });

  const balances = loans.map((l) => l.balanceCents);
  const minimums = loans.map((l) => l.minimumCents);
  const budget = minimums.reduce((a, b) => a + b, 0);

  let totalInterestCents = 0;
  let months = 0;

  while (balances.some((b) => b > 0) && months < MAX_MONTHS) {
    months += 1;
    const outstandingBefore = balances.reduce((a, b) => a + (b > 0 ? b : 0), 0);

    // 1. Accrue interest on every outstanding balance (half-up to a cent).
    //    interest_cents = round_half_up(bal_cents * rateTenths / 12000)
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] <= 0) continue;
      const interest = roundHalfUp(balances[i] * loans[i].rateTenths, 12000);
      balances[i] += interest;
      totalInterestCents += interest;
    }

    // 2. Pay the minimum on every outstanding loan (capped at the balance).
    let available = accelerate ? budget : 0;
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] <= 0) continue;
      const pay = Math.min(minimums[i], balances[i]);
      balances[i] -= pay;
      if (accelerate) available -= pay;
    }

    // 3. Avalanche: throw the leftover budget at the highest-rate loan first.
    if (accelerate && available > 0) {
      for (const i of order) {
        if (available <= 0) break;
        if (balances[i] <= 0) continue;
        const pay = Math.min(available, balances[i]);
        balances[i] -= pay;
        available -= pay;
      }
    }

    // Guard against a non-amortizing loan: if outstanding principal did not
    // shrink this month, stop at the horizon deterministically.
    const outstandingAfter = balances.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    if (outstandingAfter >= outstandingBefore) {
      months = MAX_MONTHS;
      break;
    }
  }

  return [months, totalInterestCents];
}

@Injectable()
export class DebtService {
  constructor(
    @InjectRepository(LoanEntity)
    private readonly loans: Repository<LoanEntity>,
  ) {}

  async get(): Promise<DebtDto> {
    let rows: LoanEntity[];
    try {
      rows = await this.loans.find();
    } catch {
      // DB down / table missing / connection refused -> canonical 503 (DA-18).
      throw new CanonicalServiceUnavailableException();
    }

    // Loans ordered by rate desc then name (deterministic across both backends).
    const sorted = [...rows].sort((a, b) => {
      const ra = Number(a.rate);
      const rb = Number(b.rate);
      if (rb !== ra) return rb - ra;
      return a.name < b.name ? -1 : 1;
    });

    const loanDtos: LoanDto[] = sorted.map((row) => ({
      name: row.name,
      balance: formatMoney(row.balance),
      rate: formatRate(row.rate),
      minimum_payment: formatMoney(row.minimumPayment),
      priority: row.priority,
    }));

    const totalCents = sorted.reduce((a, r) => a + toCents(r.balance), 0);
    const minimumCents = sorted.reduce(
      (a, r) => a + toCents(r.minimumPayment),
      0,
    );

    const simLoans: SimLoan[] = sorted.map((row) => ({
      name: row.name,
      balanceCents: toCents(row.balance),
      minimumCents: toCents(row.minimumPayment),
      rateTenths: rateToTenths(row.rate),
    }));

    const [avalMonths, avalInterest] = projectPayoff(simLoans, true);
    const [minMonths, minInterest] = projectPayoff(simLoans, false);

    const payoff: PayoffProjectionDto[] = [
      {
        strategy: 'avalanche',
        debt_free_year: monthsToYear(avalMonths),
        total_interest: centsToMoney(avalInterest),
      },
      {
        strategy: 'minimums',
        debt_free_year: monthsToYear(minMonths),
        total_interest: centsToMoney(minInterest),
      },
    ];

    return {
      total: centsToMoney(totalCents),
      weighted_avg_rate: weightedAvgRate(sorted),
      monthly_minimum: centsToMoney(minimumCents),
      tranches: buildTranches(sorted),
      payoff,
      loans: loanDtos,
    };
  }
}

/** Render a DB numeric rate as a JSON number, one decimal (parity / DA-22). */
export function formatRate(value: string): number {
  return Number(Number(value).toFixed(1));
}

/** annual rate string -> integer tenths-of-a-percent (e.g. "6.8" -> 68). */
export function rateToTenths(value: string): number {
  return Math.round(Number(value) * 10);
}

/** Balance-weighted average interest rate (0 when no balance), one decimal. */
export function weightedAvgRate(rows: LoanEntity[]): number {
  let totalBalanceCents = 0;
  let weighted = 0; // sum(balance_cents * rate)
  for (const r of rows) {
    const balCents = toCents(r.balance);
    totalBalanceCents += balCents;
    weighted += balCents * Number(r.rate);
  }
  if (totalBalanceCents <= 0) return 0;
  return Number((weighted / totalBalanceCents).toFixed(1));
}

/** Group loans by (rate, priority) into rate tranches, ordered rate desc. */
export function buildTranches(rows: LoanEntity[]): DebtTrancheDto[] {
  const groups = new Map<
    string,
    { rate: number; priority: string; balanceCents: number; count: number }
  >();
  for (const r of rows) {
    const rate = formatRate(r.rate);
    const key = `${rate}|${r.priority}`;
    const existing = groups.get(key);
    if (existing) {
      existing.balanceCents += toCents(r.balance);
      existing.count += 1;
    } else {
      groups.set(key, {
        rate,
        priority: r.priority,
        balanceCents: toCents(r.balance),
        count: 1,
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      return (
        (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
      );
    })
    .map((g) => ({
      rate: g.rate,
      balance: formatMoney((g.balanceCents / 100).toFixed(2)),
      loan_count: g.count,
      priority: g.priority,
    }));
}
