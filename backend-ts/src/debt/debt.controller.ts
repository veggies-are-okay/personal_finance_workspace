import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { DebtQueryDto } from './debt-query.dto';
import { DebtDto } from './debt-response.dto';
import { DebtService } from './debt.service';

/**
 * `GET /api/v1/debt` — the Debt view (P4.5).
 *
 * Parity twin of the FastAPI router in `backend-python/app/routers/debt.py`:
 * same path, same optional `strategy` query param (validated against the payoff
 * registry; out-of-registry -> canonical 422), same response shape composed
 * from the `loans` table, same money/rate/enum conventions, same canonical 422
 * (validation) / 503 (DB-unavailable) error bodies. The `strategy` param does
 * NOT change the body — both payoff projections are always returned.
 */
@ApiTags('view')
@Controller('api/v1/debt')
export class DebtController {
  constructor(private readonly debtService: DebtService) {}

  @Get()
  @ApiOkResponse({ type: DebtDto })
  @ApiUnprocessableEntityResponse({
    description: 'Request validation failed (canonical error envelope).',
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  get(@Query() _query: DebtQueryDto): Promise<DebtDto> {
    // `_query` is validated by the global ValidationPipe (strategy registry);
    // both projections are always returned regardless of its value.
    return this.debtService.get();
  }
}
