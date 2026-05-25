import { Test, TestingModule } from '@nestjs/testing';

import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';

describe('InvestmentsController', () => {
  let controller: InvestmentsController;
  const get = jest.fn();

  beforeEach(async () => {
    get.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvestmentsController],
      providers: [{ provide: InvestmentsService, useValue: { get } }],
    }).compile();
    controller = module.get(InvestmentsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to InvestmentsService.get', async () => {
    const expected = {
      portfolio_value: '0.00',
      unrealized_gain: '0.00',
      allocation: [],
      concentration: [],
      holdings: [],
    };
    get.mockResolvedValue(expected);
    const result = await controller.get();
    expect(result).toBe(expected);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
