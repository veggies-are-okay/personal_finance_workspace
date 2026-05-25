import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { TransactionQueryDto } from './transaction-query.dto';
import { PaginatedTransactionsDto } from './transaction-response.dto';
import { TransactionsService } from './transactions.service';

/**
 * `GET /api/v1/transactions` — list/search/filter/paginate (P4.1).
 *
 * Parity twin of the FastAPI router in
 * `backend-python/app/routers/transactions.py`: same path, same query params,
 * same `Paginated<T>` envelope, same money/date conventions, same canonical
 * 422 (validation) / 503 (DB-unavailable) error bodies. The global
 * `ValidationPipe({ transform: true })` validates `TransactionQueryDto`.
 */
@ApiTags('view')
@Controller('api/v1/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOkResponse({ type: PaginatedTransactionsDto })
  @ApiUnprocessableEntityResponse({
    description: 'Request validation failed (canonical error envelope).',
  })
  list(@Query() query: TransactionQueryDto): Promise<PaginatedTransactionsDto> {
    return this.transactionsService.list(query);
  }
}
