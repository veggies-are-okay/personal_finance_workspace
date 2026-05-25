import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { GoalsDto } from './goals-response.dto';
import { GoalsService } from './goals.service';

/**
 * `GET /api/v1/goals` — the Goals view (P4.6).
 *
 * Parity twin of the FastAPI router in `backend-python/app/routers/goals.py`:
 * same path, no query params, same response shape composed from the `goals`
 * table, same money/percentage conventions, same canonical 503 (DB-unavailable)
 * error body.
 */
@ApiTags('view')
@Controller('api/v1/goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOkResponse({ type: GoalsDto })
  get(): Promise<GoalsDto> {
    return this.goalsService.get();
  }
}
