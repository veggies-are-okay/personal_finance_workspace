import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * Request + response DTOs for the connections API (P6.1) — parity twins of the
 * FastAPI Pydantic models in `backend-python/app/connections/schemas.py`.
 *
 * The `@nestjs/swagger` annotations must make the generated OpenAPI normalize
 * IDENTICALLY to the canonical contract and the FastAPI schema (the parity
 * harness diffs all three structurally). Conventions:
 *  - enums (`Source`/`SourceMode`/`ItemStatus`) are plain strings on the wire;
 *  - datetimes (`expiration`/`last_synced`) are ISO-8601 UTC `...Z` strings;
 *  - `last_synced` is OPTIONAL (omitted when absent, never null).
 */

// --- POST /connections/link-token ------------------------------------------

export class LinkTokenCreateRequestDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['transactions', 'liabilities'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  products?: string[];
}

export class LinkTokenResponseDto {
  @ApiProperty({ type: String, example: 'link-sandbox-0000-synthetic' })
  link_token!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-05-24T10:30:00Z',
  })
  expiration!: string;
}

// --- POST /connections/exchange --------------------------------------------

export class ExchangeRequestDto {
  @ApiProperty({ type: String, example: 'public-sandbox-0000-synthetic' })
  @IsString()
  public_token!: string;
}

export class ExchangeResponseDto {
  @ApiProperty({ type: String, example: 'item-synthetic-001' })
  item_id!: string;

  @ApiProperty({ type: String, example: 'connected' })
  status!: string;
}

// --- GET /connections ------------------------------------------------------

export class ConnectionItemDto {
  @ApiProperty({ type: String, example: 'item-synthetic-001' })
  item_id!: string;

  @ApiProperty({ type: String, example: 'Example Bank' })
  institution!: string;

  @ApiProperty({ type: [String], example: ['transactions', 'liabilities'] })
  products!: string[];

  @ApiProperty({ type: String, example: 'connected' })
  status!: string;

  @ApiProperty({ type: [String], example: ['transactions', 'loans'] })
  sources!: string[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-05-24T09:00:00Z',
  })
  last_synced?: string;
}

export class SourceConnectionDto {
  @ApiProperty({ type: String, example: 'transactions' })
  source!: string;

  @ApiProperty({ type: String, example: 'api' })
  mode!: string;

  @ApiProperty({ type: String, example: 'connected' })
  status!: string;
}

export class ConnectionsListDto {
  @ApiProperty({ type: [ConnectionItemDto] })
  items!: ConnectionItemDto[];

  @ApiProperty({ type: [SourceConnectionDto] })
  sources!: SourceConnectionDto[];
}

// --- POST /connections/webhook ---------------------------------------------

export class WebhookRequestDto {
  @ApiProperty({ type: String, example: 'TRANSACTIONS' })
  @IsString()
  webhook_type!: string;

  @ApiProperty({ type: String, example: 'SYNC_UPDATES_AVAILABLE' })
  @IsString()
  webhook_code!: string;

  @ApiPropertyOptional({ type: String, example: 'item-synthetic-001' })
  @IsOptional()
  @IsString()
  item_id?: string;
}

export class AcknowledgementDto {
  @ApiProperty({ type: String, example: 'accepted' })
  status!: string;
}
