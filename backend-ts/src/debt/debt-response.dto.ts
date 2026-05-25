import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTOs for `GET /api/v1/debt` — parity twin of the FastAPI `Debt`
 * Pydantic models. The `@nestjs/swagger` annotations must make the generated
 * OpenAPI normalize IDENTICALLY to the canonical contract and the FastAPI
 * schema (the parity harness diffs all three structurally). In particular:
 *  - money fields (`total`, `monthly_minimum`, `balance`, `minimum_payment`,
 *    `total_interest`) are decimal STRINGS (Appendix A / DA-2) -> `type: String`;
 *  - rate fields (`rate`, `weighted_avg_rate`) are JSON NUMBERS 0-100 (DA-22)
 *    -> `type: 'number'`;
 *  - `loan_count` / `debt_free_year` are integers;
 *  - `priority` / `strategy` are the lower_snake enum values shared with the
 *    canonical registry.
 * All fields are required (no optionals on this view).
 */
export class LoanDto {
  @ApiProperty({ type: String, example: 'Student Loan A' })
  name!: string;

  @ApiProperty({ type: String, example: '12000.00' })
  balance!: string;

  @ApiProperty({ type: 'number', example: 6.8 })
  rate!: number;

  @ApiProperty({ type: String, example: '150.00' })
  minimum_payment!: string;

  @ApiProperty({ type: String, example: 'pay_first' })
  priority!: string;
}

export class DebtTrancheDto {
  @ApiProperty({ type: 'number', example: 6.8 })
  rate!: number;

  @ApiProperty({ type: String, example: '12000.00' })
  balance!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  loan_count!: number;

  @ApiProperty({ type: String, example: 'pay_first' })
  priority!: string;
}

export class PayoffProjectionDto {
  @ApiProperty({ type: String, example: 'avalanche' })
  strategy!: string;

  @ApiProperty({ type: 'integer', example: 2031 })
  debt_free_year!: number;

  @ApiProperty({ type: String, example: '4120.00' })
  total_interest!: string;
}

export class DebtDto {
  @ApiProperty({ type: String, example: '26560.00' })
  total!: string;

  @ApiProperty({ type: 'number', example: 5.4 })
  weighted_avg_rate!: number;

  @ApiProperty({ type: String, example: '320.00' })
  monthly_minimum!: string;

  @ApiProperty({ type: [DebtTrancheDto] })
  tranches!: DebtTrancheDto[];

  @ApiProperty({ type: [PayoffProjectionDto] })
  payoff!: PayoffProjectionDto[];

  @ApiProperty({ type: [LoanDto] })
  loans!: LoanDto[];
}
