import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Validated query params for `GET /api/v1/budget` (parity twin of the FastAPI
 * `window` query parameter). A single optional rolling-window selector, default
 * `12m`. Any non-string value routes through the canonical validation exception
 * factory -> HTTP 422 canonical envelope (DA-1).
 */
export class BudgetQueryDto {
  @ApiPropertyOptional({
    description: 'Rolling window selector, e.g. "3m", "12m", "ytd".',
    default: '12m',
  })
  @IsOptional()
  @IsString()
  window: string = '12m';
}
