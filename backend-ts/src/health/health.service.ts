import { Injectable } from '@nestjs/common';

import { HealthResponseDto } from './health-response.dto';

/**
 * Liveness logic for the canonical `/health` endpoint.
 *
 * Deliberately trivial and DB-independent: it always reports `ok`. Keeping the
 * logic here (rather than inline in the controller) mirrors the FastAPI
 * service/route split and gives the unit suite a clean seam to test.
 */
@Injectable()
export class HealthService {
  check(): HealthResponseDto {
    return { status: 'ok' };
  }
}
