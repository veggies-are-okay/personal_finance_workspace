import { Test, TestingModule } from '@nestjs/testing';

import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

describe('GoalsController', () => {
  let controller: GoalsController;
  const get = jest.fn();

  beforeEach(async () => {
    get.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GoalsController],
      providers: [{ provide: GoalsService, useValue: { get } }],
    }).compile();
    controller = module.get(GoalsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to GoalsService.get', async () => {
    const expected = {
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
    get.mockResolvedValue(expected);
    const result = await controller.get();
    expect(result).toBe(expected);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
