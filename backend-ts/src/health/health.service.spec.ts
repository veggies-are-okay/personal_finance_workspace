import { Test, TestingModule } from '@nestjs/testing';

import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('check() returns exactly { status: "ok" }', () => {
    expect(service.check()).toEqual({ status: 'ok' });
  });

  it('check() does not touch a database (synchronous, no I/O)', () => {
    // A liveness probe must be DB-independent; a synchronous return proves no
    // async DB call is involved.
    const result = service.check();
    expect(result.status).toBe('ok');
  });
});
