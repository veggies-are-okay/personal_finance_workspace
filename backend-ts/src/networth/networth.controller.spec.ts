import { Test, TestingModule } from '@nestjs/testing';

import { NetWorthQueryDto } from './networth-query.dto';
import { NetWorthController } from './networth.controller';
import { NetWorthService } from './networth.service';

describe('NetWorthController', () => {
  let controller: NetWorthController;
  const get = jest.fn();

  beforeEach(async () => {
    get.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetWorthController],
      providers: [{ provide: NetWorthService, useValue: { get } }],
    }).compile();
    controller = module.get(NetWorthController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to NetWorthService.get with the window from the query DTO', async () => {
    const expected = {
      net_worth: '0.00',
      assets: '0.00',
      liabilities: '0.00',
      series: [],
      accounts: [],
    };
    get.mockResolvedValue(expected);
    const query = Object.assign(new NetWorthQueryDto(), { window: '3m' });
    const result = await controller.get(query);
    expect(result).toBe(expected);
    expect(get).toHaveBeenCalledWith('3m');
  });

  it('defaults the window to 12m', async () => {
    get.mockResolvedValue({});
    await controller.get(new NetWorthQueryDto());
    expect(get).toHaveBeenCalledWith('12m');
  });
});
