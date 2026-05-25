import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { NetWorthQueryDto } from './networth-query.dto';
import { NetWorthDto } from './networth-response.dto';
import { NetWorthService } from './networth.service';

/**
 * `GET /api/v1/networth` — the Net Worth view (P4.3).
 *
 * Parity twin of the FastAPI router in `backend-python/app/routers/networth.py`:
 * same path, same optional `window` query param (default `12m`), same response
 * shape composed from the `accounts` table, same money conventions, same
 * canonical 422 (validation) / 503 (DB-unavailable) error bodies. The global
 * `ValidationPipe` validates `NetWorthQueryDto`.
 */
@ApiTags('view')
@Controller('api/v1/networth')
export class NetWorthController {
  constructor(private readonly netWorthService: NetWorthService) {}

  @Get()
  @ApiOkResponse({ type: NetWorthDto })
  @ApiUnprocessableEntityResponse({
    description: 'Request validation failed (canonical error envelope).',
  })
  get(@Query() query: NetWorthQueryDto): Promise<NetWorthDto> {
    return this.netWorthService.get(query.window);
  }
}
