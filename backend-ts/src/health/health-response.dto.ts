import { ApiProperty } from '@nestjs/swagger';

/**
 * Canonical `GET /health` response body.
 *
 * Mirrors the FastAPI `HealthResponse` Pydantic model exactly (see
 * `backend-python/app/schemas.py`): a single `status` string. The endpoint is
 * intentionally DB-independent and always serializes to `{"status":"ok"}` so it
 * stays byte-identical across both backends (see `.claude/rules/backend-parity.md`).
 */
export class HealthResponseDto {
  @ApiProperty({ type: String, example: 'ok' })
  status!: string;
}
