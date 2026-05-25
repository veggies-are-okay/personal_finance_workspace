import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTOs for `GET /api/v1/investments` — parity twin of the FastAPI
 * `Investments` Pydantic models. The `@nestjs/swagger` annotations must make the
 * generated OpenAPI normalize IDENTICALLY to the canonical contract and the
 * FastAPI schema (the parity harness diffs all three structurally). In
 * particular:
 *  - money fields (`portfolio_value`, `unrealized_gain`, allocation `amount`,
 *    holding `value`/`gain`) are decimal STRINGS (Appendix A / DA-2) ->
 *    `type: String`;
 *  - percentages (allocation `target_pct`/`actual_pct`, concentration `weight`,
 *    holding `weight`) are JSON NUMBERS on a 0-100 scale (DA-22) ->
 *    `type: 'number'`.
 * All fields are required (no optionals on this view).
 */
export class AllocationDto {
  @ApiProperty({ type: String, example: 'equities' })
  class!: string;

  @ApiProperty({ type: 'number', example: 80.0 })
  target_pct!: number;

  @ApiProperty({ type: 'number', example: 82.0 })
  actual_pct!: number;

  @ApiProperty({ type: String, example: '49200.00' })
  amount!: string;
}

export class ConcentrationDto {
  @ApiProperty({ type: String, example: 'VTI' })
  holding!: string;

  @ApiProperty({ type: 'number', example: 45.0 })
  weight!: number;
}

export class HoldingDto {
  @ApiProperty({ type: String, example: 'VTI' })
  symbol!: string;

  @ApiProperty({ type: String, example: 'Total Market ETF' })
  name!: string;

  @ApiProperty({ type: String, example: '27000.00' })
  value!: string;

  @ApiProperty({ type: 'number', example: 45.0 })
  weight!: number;

  @ApiProperty({ type: String, example: '3600.00' })
  gain!: string;
}

export class InvestmentsDto {
  @ApiProperty({ type: String, example: '60000.00' })
  portfolio_value!: string;

  @ApiProperty({ type: String, example: '8200.00' })
  unrealized_gain!: string;

  @ApiProperty({ type: [AllocationDto] })
  allocation!: AllocationDto[];

  @ApiProperty({ type: [ConcentrationDto] })
  concentration!: ConcentrationDto[];

  @ApiProperty({ type: [HoldingDto] })
  holdings!: HoldingDto[];
}
