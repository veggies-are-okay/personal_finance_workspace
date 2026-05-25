import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { NetWorthQueryDto } from './networth-query.dto';
import {
  NetWorthAccountDto,
  NetWorthDto,
  NetWorthSeriesPointDto,
} from './networth-response.dto';

describe('NetWorthQueryDto', () => {
  it('defaults window to 12m and validates clean', () => {
    const dto = plainToInstance(NetWorthQueryDto, {});
    expect(dto.window).toBe('12m');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts a string window', () => {
    const dto = plainToInstance(NetWorthQueryDto, { window: '3m' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.window).toBe('3m');
  });

  it('rejects a non-string window', () => {
    const dto = plainToInstance(NetWorthQueryDto, { window: 5 });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'window')).toBe(true);
  });
});

describe('response DTOs', () => {
  it('construct with the canonical wire shape', () => {
    const point = new NetWorthSeriesPointDto();
    point.month = '2026-05';
    point.retirement = '90000.00';
    point.investments = '60000.00';
    point.cash = '28900.00';

    const account = new NetWorthAccountDto();
    account.name = 'Brokerage';
    account.type = 'investment';
    account.balance = '60000.00';
    account.delta_30d = '0.00';

    const body = new NetWorthDto();
    body.net_worth = '152340.00';
    body.assets = '178900.00';
    body.liabilities = '26560.00';
    body.series = [point];
    body.accounts = [account];

    expect(body.accounts[0].balance).toBe('60000.00');
    expect(body.series[0].month).toBe('2026-05');
    expect(body.net_worth).toBe('152340.00');
  });
});
