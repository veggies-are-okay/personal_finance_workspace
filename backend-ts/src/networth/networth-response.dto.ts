import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTOs for `GET /api/v1/networth` — parity twin of the FastAPI
 * `NetWorth` Pydantic models. The `@nestjs/swagger` annotations must make the
 * generated OpenAPI normalize IDENTICALLY to the canonical contract and the
 * FastAPI schema (the parity harness diffs all three structurally). In
 * particular:
 *  - money fields (`net_worth`, `assets`, `liabilities`, `balance`, `delta_30d`,
 *    and the series `retirement`/`investments`/`cash`) are decimal STRINGS
 *    (Appendix A / DA-2) -> `type: String`;
 *  - `month` is `YYYY-MM`.
 * All fields are required (no optionals on this view).
 */
export class NetWorthSeriesPointDto {
  @ApiProperty({ type: String, example: '2026-05' })
  month!: string;

  @ApiProperty({ type: String, example: '90000.00' })
  retirement!: string;

  @ApiProperty({ type: String, example: '60000.00' })
  investments!: string;

  @ApiProperty({ type: String, example: '28900.00' })
  cash!: string;
}

export class NetWorthAccountDto {
  @ApiProperty({ type: String, example: 'Brokerage' })
  name!: string;

  @ApiProperty({ type: String, example: 'investment' })
  type!: string;

  @ApiProperty({ type: String, example: '60000.00' })
  balance!: string;

  @ApiProperty({ type: String, example: '1250.00' })
  delta_30d!: string;
}

export class NetWorthDto {
  @ApiProperty({ type: String, example: '152340.00' })
  net_worth!: string;

  @ApiProperty({ type: String, example: '178900.00' })
  assets!: string;

  @ApiProperty({ type: String, example: '26560.00' })
  liabilities!: string;

  @ApiProperty({ type: [NetWorthSeriesPointDto] })
  series!: NetWorthSeriesPointDto[];

  @ApiProperty({ type: [NetWorthAccountDto] })
  accounts!: NetWorthAccountDto[];
}
