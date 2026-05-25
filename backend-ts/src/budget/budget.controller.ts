import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { BudgetQueryDto } from './budget-query.dto';
import { BudgetDto } from './budget-response.dto';
import { BudgetService } from './budget.service';

/**
 * `GET /api/v1/budget` — the Budget view (P4.2).
 *
 * Parity twin of the FastAPI router in `backend-python/app/routers/budget.py`:
 * same path, same optional `window` query param (default `12m`), same response
 * shape composed from the precomputed aggregate tables, same money/percentage/
 * date conventions, same canonical 422 (validation) / 503 (DB-unavailable) error
 * bodies. The global `ValidationPipe` validates `BudgetQueryDto`.
 */
@ApiTags('view')
@Controller('api/v1/budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get()
  @ApiOkResponse({ type: BudgetDto })
  @ApiUnprocessableEntityResponse({
    description: 'Request validation failed (canonical error envelope).',
  })
  get(@Query() query: BudgetQueryDto): Promise<BudgetDto> {
    return this.budgetService.get(query.window);
  }
}
