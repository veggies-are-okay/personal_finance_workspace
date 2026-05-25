import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Validated query params for `GET /api/v1/transactions` (parity twin of the
 * FastAPI `TransactionQuery` Pydantic model).
 *
 * With the global `ValidationPipe({ transform: true })`, query strings are
 * coerced (`@Type(() => Number)`) and validated; a failure routes through the
 * canonical validation exception factory -> HTTP 422 canonical envelope (DA-1).
 *
 * Field-for-field with the canonical contract parameters:
 *  - `limit`  integer 1-200, default 50
 *  - `offset` integer >= 0,  default 0
 *  - `date_from` / `date_to` optional `YYYY-MM-DD`
 *  - `account` / `category` / `q` optional strings
 */
export class TransactionQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a YYYY-MM-DD date' })
  date_from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound (YYYY-MM-DD).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a YYYY-MM-DD date' })
  date_to?: string;

  @ApiPropertyOptional({ description: 'Account name filter.' })
  @IsOptional()
  @IsString()
  account?: string;

  @ApiPropertyOptional({ description: 'Category name filter.' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Free-text description search.' })
  @IsOptional()
  @IsString()
  q?: string;
}
