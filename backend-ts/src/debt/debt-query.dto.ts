import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Validated query params for `GET /api/v1/debt` (parity twin of the FastAPI
 * `strategy` query parameter, typed as the `PayoffStrategy` enum).
 *
 * `strategy` is an OPTIONAL payoff-strategy selector restricted to the canonical
 * registry (`avalanche` | `minimums`). An out-of-registry value routes through
 * the canonical validation exception factory -> HTTP 422 canonical envelope
 * (DA-1). It does NOT change the response shape — the service always returns
 * both projections.
 */
export class DebtQueryDto {
  @ApiPropertyOptional({
    description: 'Payoff strategy to highlight (avalanche | minimums).',
    enum: ['avalanche', 'minimums'],
  })
  @IsOptional()
  @IsIn(['avalanche', 'minimums'], {
    message: 'strategy must be one of: avalanche, minimums',
  })
  strategy?: string;
}
