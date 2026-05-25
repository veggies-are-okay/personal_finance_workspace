import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTOs for `GET /api/v1/transactions` — parity twin of the FastAPI
 * `Transaction` / `Pagination` / `PaginatedTransactions` Pydantic models.
 *
 * The `@nestjs/swagger` annotations must make the generated OpenAPI normalize
 * IDENTICALLY to the canonical contract and the FastAPI schema (the parity
 * harness diffs all three structurally). In particular:
 *  - `category` / `bucket` are OPTIONAL strings (omitted when absent, never null),
 *    so they are `@ApiPropertyOptional` and dropped at runtime when `undefined`.
 *  - `amount` is a decimal STRING (Appendix A / DA-2); `date` is `YYYY-MM-DD`.
 *  - required keys: date, account, description, amount, is_recurring.
 */
export class TransactionDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-05-20' })
  date!: string;

  @ApiProperty({ type: String, example: 'Checking' })
  account!: string;

  @ApiProperty({ type: String, example: 'Coffee Shop' })
  description!: string;

  @ApiPropertyOptional({ type: String, example: 'dining' })
  category?: string;

  @ApiPropertyOptional({ type: String, example: 'wants' })
  bucket?: string;

  @ApiProperty({ type: String, example: '-4.75' })
  amount!: string;

  @ApiProperty({ type: Boolean, example: false })
  is_recurring!: boolean;
}

export class PaginationDto {
  // `type: 'integer'` (string) so the generated OpenAPI says `integer`, matching
  // the canonical contract + FastAPI (`type: Number` would emit `number`).
  @ApiProperty({ type: 'integer', example: 50 })
  limit!: number;

  @ApiProperty({ type: 'integer', example: 0 })
  offset!: number;

  @ApiProperty({ type: 'integer', example: 128 })
  total!: number;
}

export class PaginatedTransactionsDto {
  @ApiProperty({ type: [TransactionDto] })
  data!: TransactionDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}
