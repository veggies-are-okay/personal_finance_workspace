import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTOs for `GET /api/v1/goals` — parity twin of the FastAPI `Goals`
 * Pydantic models. The `@nestjs/swagger` annotations must make the generated
 * OpenAPI normalize IDENTICALLY to the canonical contract and the FastAPI schema
 * (the parity harness diffs all three structurally). In particular:
 *  - money fields (`target`, `saved`, funding `amount`, and the affordability
 *    money fields) are decimal STRINGS (Appendix A / DA-2) -> `type: String`;
 *  - `progress_pct` and `income_share` are JSON NUMBERS on a 0-100 scale
 *    (DA-22) -> `type: 'number'`.
 * All fields are required (no optionals on this view).
 */
export class GoalFundingDto {
  @ApiProperty({ type: String, example: 'savings' })
  source!: string;

  @ApiProperty({ type: String, example: '15000.00' })
  amount!: string;
}

export class AffordabilityDto {
  @ApiProperty({ type: String, example: '420000.00' })
  price!: string;

  @ApiProperty({ type: String, example: '84000.00' })
  down_payment!: string;

  @ApiProperty({ type: String, example: '336000.00' })
  mortgage!: string;

  @ApiProperty({ type: String, example: '2450.00' })
  monthly_piti!: string;

  @ApiProperty({ type: 'number', example: 28.0 })
  income_share!: number;
}

export class GoalsDto {
  @ApiProperty({ type: String, example: '60000.00' })
  target!: string;

  @ApiProperty({ type: String, example: '21000.00' })
  saved!: string;

  @ApiProperty({ type: 'number', example: 35.0 })
  progress_pct!: number;

  @ApiProperty({ type: [GoalFundingDto] })
  funding!: GoalFundingDto[];

  @ApiProperty({ type: AffordabilityDto })
  affordability!: AffordabilityDto;
}
