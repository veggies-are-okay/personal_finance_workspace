import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { InvestmentsDto } from './investments-response.dto';
import { InvestmentsService } from './investments.service';

/**
 * `GET /api/v1/investments` — the Investments view (P4.4).
 *
 * Parity twin of the FastAPI router in
 * `backend-python/app/routers/investments.py`: same path, no query params, same
 * response shape derived from the `holdings` table, same money/percentage
 * conventions, same canonical 503 (DB-unavailable) error body.
 */
@ApiTags('view')
@Controller('api/v1/investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get()
  @ApiOkResponse({ type: InvestmentsDto })
  get(): Promise<InvestmentsDto> {
    return this.investmentsService.get();
  }
}
