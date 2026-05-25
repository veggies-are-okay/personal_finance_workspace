import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { HoldingEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import {
  InvestmentsService,
  centsToMoney,
  pct,
  toCents,
} from './investments.service';

/**
 * Unit tests for `InvestmentsService` (parity twin of the FastAPI
 * `test_investments.py`). The holdings repository is faked so we assert the
 * service's behaviour — portfolio totals (summed in integer cents), allocation
 * target/actual derivation, concentration ranking, deterministic ordering,
 * money/percent mapping, empty-DB zeros/empties, and the canonical 503 on DB
 * failure — without a live DB. No recompute happens here (DA-23).
 */

// Synthetic portfolio; rows deliberately out of symbol order to exercise sort.
// portfolio = 27000 + 18000 + 5000 = 50000.
const HOLDINGS = [
  {
    symbol: 'VXUS',
    name: 'Total Intl ETF',
    value: '18000.00',
    weight: '35.0',
    gain: '1500.00',
    assetClass: 'equities',
  },
  {
    symbol: 'VTI',
    name: 'Total Market ETF',
    value: '27000.00',
    weight: '45.0',
    gain: '3600.00',
    assetClass: 'equities',
  },
  {
    symbol: 'BND',
    name: 'Total Bond ETF',
    value: '5000.00',
    weight: '20.0',
    gain: '-200.00',
    assetClass: 'bonds',
  },
];

function buildService(
  find: jest.Mock,
): Promise<{ service: InvestmentsService }> {
  return Test.createTestingModule({
    providers: [
      InvestmentsService,
      { provide: getRepositoryToken(HoldingEntity), useValue: { find } },
    ],
  })
    .compile()
    .then((module: TestingModule) => ({
      service: module.get<InvestmentsService>(InvestmentsService),
    }));
}

describe('InvestmentsService', () => {
  describe('seeded portfolio', () => {
    let body: Awaited<ReturnType<InvestmentsService['get']>>;

    beforeEach(async () => {
      const { service } = await buildService(
        jest.fn().mockResolvedValue(HOLDINGS),
      );
      body = await service.get();
    });

    it('totals money in cents as decimal strings (DA-2)', () => {
      expect(body.portfolio_value).toBe('50000.00');
      expect(body.unrealized_gain).toBe('4900.00'); // 3600 + 1500 - 200
    });

    it('derives allocation target (summed weights) vs actual (market share)', () => {
      expect(body.allocation.map((a) => a.class)).toEqual([
        'bonds',
        'equities',
      ]);
      const [bonds, equities] = body.allocation;
      expect(bonds.actual_pct).toBe(10.0);
      expect(bonds.target_pct).toBe(20.0);
      expect(bonds.amount).toBe('5000.00');
      expect(equities.actual_pct).toBe(90.0); // 45000 / 50000
      expect(equities.target_pct).toBe(80.0); // 45.0 + 35.0
      expect(equities.amount).toBe('45000.00');
      expect(typeof equities.actual_pct).toBe('number');
    });

    it('ranks concentration by descending market-value share', () => {
      expect(body.concentration.map((c) => c.holding)).toEqual([
        'VTI',
        'VXUS',
        'BND',
      ]);
      expect(body.concentration[0].weight).toBe(54.0);
      expect(body.concentration[1].weight).toBe(36.0);
      expect(body.concentration[2].weight).toBe(10.0);
    });

    it('maps holdings (money strings + numeric weight) preserving repo order', () => {
      // Holdings ordering is delegated to the DB (`find({order:{symbol:'ASC'}})`,
      // mirroring FastAPI's `ORDER BY symbol`); the cross-backend parity test
      // asserts the by-symbol order against a real DB. Here the fake repo returns
      // rows verbatim, so the service must preserve that order (no re-sort).
      expect(body.holdings.map((h) => h.symbol)).toEqual([
        'VXUS',
        'VTI',
        'BND',
      ]);
      const vti = body.holdings.find((h) => h.symbol === 'VTI')!;
      expect(vti.value).toBe('27000.00');
      expect(vti.gain).toBe('3600.00');
      expect(vti.weight).toBe(45.0);
      const bnd = body.holdings.find((h) => h.symbol === 'BND')!;
      expect(bnd.gain).toBe('-200.00'); // signed money string
    });
  });

  it('buckets a NULL asset_class as "unclassified"', async () => {
    const { service } = await buildService(
      jest.fn().mockResolvedValue([
        {
          symbol: 'CASHX',
          name: 'Money Market',
          value: '1000.00',
          weight: '100.0',
          gain: '0.00',
          assetClass: null,
        },
      ]),
    );
    const body = await service.get();
    expect(body.allocation.map((a) => a.class)).toEqual(['unclassified']);
    expect(body.allocation[0].actual_pct).toBe(100.0);
    expect(body.allocation[0].target_pct).toBe(100.0);
  });

  it('returns zeros + empty arrays for an empty DB', async () => {
    const { service } = await buildService(jest.fn().mockResolvedValue([]));
    const body = await service.get();
    expect(body).toEqual({
      portfolio_value: '0.00',
      unrealized_gain: '0.00',
      allocation: [],
      concentration: [],
      holdings: [],
    });
  });

  it('avoids division by zero when the portfolio is worth 0', async () => {
    const { service } = await buildService(
      jest.fn().mockResolvedValue([
        {
          symbol: 'ZERO',
          name: 'Worthless Position',
          value: '0.00',
          weight: '0.0',
          gain: '0.00',
          assetClass: 'equities',
        },
      ]),
    );
    const body = await service.get();
    expect(body.portfolio_value).toBe('0.00');
    expect(body.allocation[0].actual_pct).toBe(0);
    expect(body.concentration[0].weight).toBe(0);
  });

  it('maps a repository failure to the canonical 503 (DA-18)', async () => {
    const { service } = await buildService(
      jest.fn().mockRejectedValue(new Error('connection refused')),
    );
    await expect(service.get()).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('money + percentage helpers', () => {
  it.each([
    ['27000.00', 2700000n],
    ['-200.00', -20000n],
    ['0.00', 0n],
    ['5000', 500000n],
    ['1.5', 150n],
  ])('toCents("%s") -> %s', (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each([
    [2700000n, '27000.00'],
    [-20000n, '-200.00'],
    [0n, '0.00'],
    [150n, '1.50'],
  ])('centsToMoney(%s) -> "%s"', (input, expected) => {
    expect(centsToMoney(input)).toBe(expected);
  });

  it('pct returns 0 when the whole is 0', () => {
    expect(pct(100n, 0n)).toBe(0);
  });

  it('pct computes a one-decimal market share', () => {
    expect(pct(2700000n, 5000000n)).toBe(54.0);
  });
});
