import { Test, TestingModule } from '@nestjs/testing';

import { BudgetQueryDto } from './budget-query.dto';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

describe('BudgetController', () => {
  let controller: BudgetController;
  const get = jest.fn();

  beforeEach(async () => {
    get.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BudgetController],
      providers: [{ provide: BudgetService, useValue: { get } }],
    }).compile();
    controller = module.get(BudgetController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to BudgetService.get with the window from the query DTO', async () => {
    const expected = {
      savings_rate: 0,
      effective_tax_rate: 0,
      buckets: [],
      categories: [],
      monthly: [],
      recurring: [],
    };
    get.mockResolvedValue(expected);
    const query = Object.assign(new BudgetQueryDto(), { window: '3m' });
    const result = await controller.get(query);
    expect(result).toBe(expected);
    expect(get).toHaveBeenCalledWith('3m');
  });

  it('defaults the window to 12m', async () => {
    get.mockResolvedValue({});
    await controller.get(new BudgetQueryDto());
    expect(get).toHaveBeenCalledWith('12m');
  });
});
