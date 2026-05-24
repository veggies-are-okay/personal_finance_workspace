import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { HealthResponseDto } from './health-response.dto';
import { HealthService } from './health.service';

/**
 * Canonical liveness probe.
 *
 * `GET /health` → 200, JSON body exactly `{"status":"ok"}`. Mirrors the FastAPI
 * route in `backend-python/app/main.py`. No global route prefix is applied, so
 * the path is at the root (matching FastAPI).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(200)
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return this.healthService.check();
  }
}
