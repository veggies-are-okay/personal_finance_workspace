import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTOs for `GET /api/v1/budget` — parity twin of the FastAPI `Budget`
 * Pydantic models. The `@nestjs/swagger` annotations must make the generated
 * OpenAPI normalize IDENTICALLY to the canonical contract and the FastAPI schema
 * (the parity harness diffs all three structurally). In particular:
 *  - money fields (`amount`, `needs`, `wants`, `monthly_est`) are decimal
 *    STRINGS (Appendix A / DA-2) -> `type: String`;
 *  - percentages (`savings_rate`, `effective_tax_rate`, `target_pct`,
 *    `actual_pct`) are JSON NUMBERS on a 0-100 scale (DA-22) -> `type: 'number'`;
 *  - `month` is `YYYY-MM`; `last_charged` is `YYYY-MM-DD`.
 * All fields are required (no optionals on this view).
 */
export class BudgetBucketDto {
  @ApiProperty({ type: String, example: 'needs' })
  name!: string;

  @ApiProperty({ type: 'number', example: 50.0 })
  target_pct!: number;

  @ApiProperty({ type: 'number', example: 48.0 })
  actual_pct!: number;

  @ApiProperty({ type: String, example: '2400.00' })
  amount!: string;
}

export class BudgetCategoryDto {
  @ApiProperty({ type: String, example: 'groceries' })
  name!: string;

  @ApiProperty({ type: String, example: '420.00' })
  amount!: string;

  @ApiProperty({ type: String, example: 'needs' })
  bucket!: string;
}

export class MonthlyNeedsWantsDto {
  @ApiProperty({ type: String, example: '2026-05' })
  month!: string;

  @ApiProperty({ type: String, example: '2400.00' })
  needs!: string;

  @ApiProperty({ type: String, example: '1500.00' })
  wants!: string;
}

export class RecurringChargeDto {
  @ApiProperty({ type: String, example: 'Streaming Co' })
  merchant!: string;

  @ApiProperty({ type: String, example: 'entertainment' })
  category!: string;

  @ApiProperty({ type: String, example: 'monthly' })
  cadence!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-05-01' })
  last_charged!: string;

  @ApiProperty({ type: String, example: '15.99' })
  monthly_est!: string;
}

export class BudgetDto {
  @ApiProperty({ type: 'number', example: 22.0 })
  savings_rate!: number;

  @ApiProperty({ type: 'number', example: 18.5 })
  effective_tax_rate!: number;

  @ApiProperty({ type: [BudgetBucketDto] })
  buckets!: BudgetBucketDto[];

  @ApiProperty({ type: [BudgetCategoryDto] })
  categories!: BudgetCategoryDto[];

  @ApiProperty({ type: [MonthlyNeedsWantsDto] })
  monthly!: MonthlyNeedsWantsDto[];

  @ApiProperty({ type: [RecurringChargeDto] })
  recurring!: RecurringChargeDto[];
}
