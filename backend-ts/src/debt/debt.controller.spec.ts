import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';

import { DebtQueryDto } from './debt-query.dto';
import { DebtController } from './debt.controller';
import { DebtService } from './debt.service';

describe('DebtController', () => {
  let controller: DebtController;
  const get = jest.fn();

  beforeEach(async () => {
    get.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DebtController],
      providers: [{ provide: DebtService, useValue: { get } }],
    }).compile();
    controller = module.get(DebtController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to DebtService.get and returns its result', async () => {
    const expected = {
      total: '0.00',
      weighted_avg_rate: 0,
      monthly_minimum: '0.00',
      tranches: [],
      payoff: [],
      loans: [],
    };
    get.mockResolvedValue(expected);
    const result = await controller.get(new DebtQueryDto());
    expect(result).toBe(expected);
    expect(get).toHaveBeenCalledWith();
  });
});

describe('DebtQueryDto validation', () => {
  it('accepts an absent strategy', async () => {
    const errors = await validate(new DebtQueryDto());
    expect(errors).toHaveLength(0);
  });

  it.each(['avalanche', 'minimums'])('accepts %s', async (strategy) => {
    const dto = Object.assign(new DebtQueryDto(), { strategy });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an out-of-registry strategy (-> 422)', async () => {
    const dto = Object.assign(new DebtQueryDto(), { strategy: 'snowball' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'strategy')).toBe(true);
  });
});
