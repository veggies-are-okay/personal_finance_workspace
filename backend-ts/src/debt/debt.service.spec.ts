import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LoanEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import {
  DebtDto,
  DebtTrancheDto,
  LoanDto,
  PayoffProjectionDto,
} from './debt-response.dto';
import {
  DebtService,
  buildTranches,
  formatRate,
  monthsToYear,
  projectPayoff,
  rateToTenths,
  roundHalfUp,
  toCents,
  weightedAvgRate,
} from './debt.service';

/**
 * Unit tests for `DebtService` (parity twin of the FastAPI `test_debt.py`). The
 * `loans` repository is faked so we assert the service's behaviour — totals,
 * weighted-average rate, rate tranches, BOTH payoff projections, deterministic
 * ordering, money/rate/enum mapping, empty-DB zeros, and the canonical 503 on
 * DB failure — without a live DB. No row is recomputed (DA-23).
 */

// Rows deliberately out of rate order to exercise the service's sort.
const LOANS = [
  {
    name: 'Loan B',
    balance: '8000.00',
    rate: '4.5',
    minimumPayment: '100.00',
    priority: 'then',
  },
  {
    name: 'Loan A',
    balance: '12000.00',
    rate: '6.8',
    minimumPayment: '150.00',
    priority: 'pay_first',
  },
  {
    name: 'Loan C',
    balance: '6560.00',
    rate: '3.2',
    minimumPayment: '70.00',
    priority: 'minimums',
  },
];

function repoReturning(rows: unknown[]): { find: jest.Mock } {
  return { find: jest.fn().mockResolvedValue(rows) };
}

function repoThrowing(): { find: jest.Mock } {
  return {
    find: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
  };
}

async function buildService(repo: { find: jest.Mock }): Promise<DebtService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DebtService,
      { provide: getRepositoryToken(LoanEntity), useValue: repo },
    ],
  }).compile();
  return module.get<DebtService>(DebtService);
}

describe('DebtService', () => {
  describe('seeded loans', () => {
    let body: Awaited<ReturnType<DebtService['get']>>;

    beforeEach(async () => {
      const service = await buildService(repoReturning(LOANS));
      body = await service.get();
    });

    it('returns the full design §3 shape', () => {
      expect(Object.keys(body).sort()).toEqual([
        'loans',
        'monthly_minimum',
        'payoff',
        'total',
        'tranches',
        'weighted_avg_rate',
      ]);
    });

    it('sums balances/minimums as decimal strings and a numeric weighted rate', () => {
      expect(body.total).toBe('26560.00');
      expect(typeof body.total).toBe('string');
      expect(body.monthly_minimum).toBe('320.00');
      // DA-22: weighted-average rate is a JSON number, 0-100, one decimal.
      expect(body.weighted_avg_rate).toBe(5.2);
      expect(typeof body.weighted_avg_rate).toBe('number');
    });

    it('orders loans by rate desc with money string + enum priority', () => {
      expect(body.loans.map((l) => l.name)).toEqual([
        'Loan A',
        'Loan B',
        'Loan C',
      ]);
      expect(body.loans[0].balance).toBe('12000.00');
      expect(body.loans[0].minimum_payment).toBe('150.00');
      expect(body.loans[0].rate).toBe(6.8);
      expect(body.loans[0].priority).toBe('pay_first');
    });

    it('groups tranches by rate desc', () => {
      expect(body.tranches.map((t) => t.rate)).toEqual([6.8, 4.5, 3.2]);
      expect(body.tranches[0].balance).toBe('12000.00');
      expect(body.tranches[0].loan_count).toBe(1);
      expect(body.tranches[0].priority).toBe('pay_first');
    });

    it('returns both payoff strategies, avalanche first', () => {
      expect(body.payoff.map((p) => p.strategy)).toEqual([
        'avalanche',
        'minimums',
      ]);
      for (const proj of body.payoff) {
        expect(typeof proj.total_interest).toBe('string');
        expect(Number.isInteger(proj.debt_free_year)).toBe(true);
      }
    });

    it('avalanche clears no later than minimums with no more interest', () => {
      const aval = body.payoff.find((p) => p.strategy === 'avalanche')!;
      const mins = body.payoff.find((p) => p.strategy === 'minimums')!;
      expect(aval.debt_free_year).toBeLessThanOrEqual(mins.debt_free_year);
      expect(Number(aval.total_interest)).toBeLessThanOrEqual(
        Number(mins.total_interest),
      );
    });
  });

  it('empty DB -> well-formed zeros + empty arrays + two zero projections', async () => {
    const service = await buildService(repoReturning([]));
    const body = await service.get();
    expect(body.total).toBe('0.00');
    expect(body.monthly_minimum).toBe('0.00');
    expect(body.weighted_avg_rate).toBe(0);
    expect(body.tranches).toEqual([]);
    expect(body.loans).toEqual([]);
    expect(body.payoff.map((p) => p.strategy)).toEqual([
      'avalanche',
      'minimums',
    ]);
    for (const proj of body.payoff) {
      expect(proj.debt_free_year).toBe(0);
      expect(proj.total_interest).toBe('0.00');
    }
  });

  it('maps a DB failure to the canonical 503 exception (DA-18)', async () => {
    const service = await buildService(repoThrowing());
    await expect(service.get()).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('debt helpers', () => {
  it.each([
    ['0.00', 0],
    ['12000.00', 1200000],
    ['-4.75', -475],
    ['150.5', 15050],
    ['0.005', 1], // sub-cent rounds half-up
  ])('toCents(%s) -> %s', (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each([
    [5, 10, 1], // 0.5 -> 1 (half-up)
    [4, 10, 0], // 0.4 -> 0
    [15, 10, 2], // 1.5 -> 2
    [0, 10, 0],
  ])('roundHalfUp(%i/%i) -> %i', (num, den, expected) => {
    expect(roundHalfUp(num, den)).toBe(expected);
  });

  it('rateToTenths + formatRate round-trip one decimal', () => {
    expect(rateToTenths('6.8')).toBe(68);
    expect(formatRate('6.80')).toBe(6.8);
    expect(formatRate('3.25')).toBe(3.3); // one-decimal half-up
  });

  it('monthsToYear maps month counts to calendar years', () => {
    expect(monthsToYear(0)).toBe(0);
    expect(monthsToYear(1)).toBe(2026);
    expect(monthsToYear(12)).toBe(2026);
    expect(monthsToYear(13)).toBe(2027);
  });

  it('weightedAvgRate is 0 with no balance', () => {
    expect(
      weightedAvgRate([
        {
          name: 'Paid',
          balance: '0.00',
          rate: '5.0',
          minimumPayment: '0.00',
          priority: 'minimums',
        } as LoanEntity,
      ]),
    ).toBe(0);
  });

  it('projectPayoff returns [0,0] for no loans', () => {
    expect(projectPayoff([], true)).toEqual([0, 0]);
  });

  it('projectPayoff caps a non-amortizing loan at the horizon', () => {
    const [months] = projectPayoff(
      [
        {
          name: 'Stuck',
          balanceCents: 1000000,
          minimumCents: 5000,
          rateTenths: 240,
        },
      ],
      false,
    );
    expect(months).toBe(600);
  });

  it('buildTranches groups same-rate loans and sums their balances', () => {
    const tranches = buildTranches([
      {
        name: 'L1',
        balance: '1000.00',
        rate: '5.0',
        minimumPayment: '50.00',
        priority: 'then',
      } as LoanEntity,
      {
        name: 'L2',
        balance: '2000.00',
        rate: '5.0',
        minimumPayment: '60.00',
        priority: 'then',
      } as LoanEntity,
    ]);
    expect(tranches).toHaveLength(1);
    expect(tranches[0].loan_count).toBe(2);
    expect(tranches[0].balance).toBe('3000.00');
  });
});

describe('response DTOs', () => {
  it('construct with the canonical wire shape (money string, rate number, enums)', () => {
    const loan = new LoanDto();
    loan.name = 'Student Loan A';
    loan.balance = '12000.00';
    loan.rate = 6.8;
    loan.minimum_payment = '150.00';
    loan.priority = 'pay_first';

    const tranche = new DebtTrancheDto();
    tranche.rate = 6.8;
    tranche.balance = '12000.00';
    tranche.loan_count = 1;
    tranche.priority = 'pay_first';

    const projection = new PayoffProjectionDto();
    projection.strategy = 'avalanche';
    projection.debt_free_year = 2034;
    projection.total_interest = '4120.00';

    const debt = new DebtDto();
    debt.total = '26560.00';
    debt.weighted_avg_rate = 5.4;
    debt.monthly_minimum = '320.00';
    debt.tranches = [tranche];
    debt.payoff = [projection];
    debt.loans = [loan];

    expect(debt.loans[0].priority).toBe('pay_first');
    expect(debt.tranches[0].loan_count).toBe(1);
    expect(debt.payoff[0].strategy).toBe('avalanche');
    expect(typeof debt.total).toBe('string');
    expect(typeof debt.weighted_avg_rate).toBe('number');
  });
});
