import { Test, TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('check() returns the canonical { status: "ok" } body', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });

  it('delegates to HealthService.check()', () => {
    const check = jest.fn().mockReturnValue({ status: 'ok' });
    const service: HealthService = { check };
    const local = new HealthController(service);
    expect(local.check()).toEqual({ status: 'ok' });
    expect(check).toHaveBeenCalledTimes(1);
  });
});
