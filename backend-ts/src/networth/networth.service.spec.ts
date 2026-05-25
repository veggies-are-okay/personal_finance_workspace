import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AccountEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import {
  NetWorthService,
  centsToDecimalString,
  toCents,
} from './networth.service';

/**
 * Unit tests for `NetWorthService` (parity twin of the FastAPI
 * `test_networth.py`). The `accounts` repository is faked so we assert the
 * service's behaviour — signed-balance composition, deterministic name ordering,
 * money-string mapping, zero `delta_30d`, empty `series`, empty-DB zeros, and the
 * canonical 503 on DB failure — without a live DB. No recompute (DA-23).
 */

// Rows deliberately out of name order to exercise the repository sort contract.
const ACCOUNTS = [
  { id: '1', name: 'Brokerage', type: 'investment', balance: '60000.00' },
  { id: '2', name: 'Checking', type: 'depository', balance: '28900.00' },
  { id: '3', name: 'Roth IRA', type: 'retirement', balance: '90000.00' },
  { id: '4', name: 'Unfunded', type: 'depository', balance: null },
  { id: '5', name: 'Visa', type: 'credit', balance: '-26560.00' },
];

describe('NetWorthService', () => {
  async function build(rows: unknown[] | Error): Promise<{
    service: NetWorthService;
    find: jest.Mock;
  }> {
    const find = jest.fn();
    if (rows instanceof Error) {
      find.mockRejectedValue(rows);
    } else {
      find.mockResolvedValue(rows);
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetWorthService,
        { provide: getRepositoryToken(AccountEntity), useValue: { find } },
      ],
    }).compile();
    return { service: module.get(NetWorthService), find };
  }

  it('composes the full design §3 shape', async () => {
    const { service } = await build(ACCOUNTS);
    const body = await service.get('12m');
    expect(Object.keys(body).sort()).toEqual([
      'accounts',
      'assets',
      'liabilities',
      'net_worth',
      'series',
    ]);
  });

  it('applies the signed-balance convention with money strings', async () => {
    const { service } = await build(ACCOUNTS);
    const body = await service.get('12m');
    // assets = 60000 + 28900 + 90000 = 178900; liabilities = abs(-26560) = 26560.
    expect(body.assets).toBe('178900.00');
    expect(body.liabilities).toBe('26560.00');
    expect(body.net_worth).toBe('152340.00');
    expect(typeof body.assets).toBe('string');
  });

  it('lists accounts in repository (name) order with a zero delta', async () => {
    const { service, find } = await build(ACCOUNTS);
    const body = await service.get('12m');
    expect(body.accounts.map((a) => a.name)).toEqual([
      'Brokerage',
      'Checking',
      'Roth IRA',
      'Unfunded',
      'Visa',
    ]);
    expect(body.accounts[0]).toEqual({
      name: 'Brokerage',
      type: 'investment',
      balance: '60000.00',
      delta_30d: '0.00',
    });
    // Deterministic ordering contract: name ASC, then id ASC.
    expect(find).toHaveBeenCalledWith({ order: { name: 'ASC', id: 'ASC' } });
  });

  it('treats a null balance as zero (no shift to totals)', async () => {
    const { service } = await build(ACCOUNTS);
    const body = await service.get('12m');
    const unfunded = body.accounts.find((a) => a.name === 'Unfunded')!;
    expect(unfunded.balance).toBe('0.00');
    const visa = body.accounts.find((a) => a.name === 'Visa')!;
    expect(visa.balance).toBe('-26560.00');
  });

  it('always returns an empty series (no history source)', async () => {
    const { service } = await build(ACCOUNTS);
    const body = await service.get('12m');
    expect(body.series).toEqual([]);
  });

  it('empty DB -> all-zero totals + empty arrays', async () => {
    const { service } = await build([]);
    const body = await service.get('12m');
    expect(body).toEqual({
      net_worth: '0.00',
      assets: '0.00',
      liabilities: '0.00',
      series: [],
      accounts: [],
    });
  });

  it('raises canonical 503 when the DB query fails (DA-18)', async () => {
    const { service } = await build(new Error('connection refused'));
    await expect(service.get('12m')).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('toCents', () => {
  it.each([
    ['60000.00', 6000000n],
    ['-26560.00', -2656000n],
    ['0.00', 0n],
    ['0.15', 15n],
    ['1234.5', 123450n],
    ['.15', 15n],
    ['12', 1200n],
  ])('toCents(%s) -> %s', (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it('treats null as zero cents', () => {
    expect(toCents(null)).toBe(0n);
  });
});

describe('centsToDecimalString', () => {
  it.each([
    [6000000n, '60000.00'],
    [-2656000n, '-26560.00'],
    [0n, '0.00'],
    [15n, '0.15'],
    [-5n, '-0.05'],
  ])('centsToDecimalString(%s) -> %s', (input, expected) => {
    expect(centsToDecimalString(input)).toBe(expected);
  });
});
