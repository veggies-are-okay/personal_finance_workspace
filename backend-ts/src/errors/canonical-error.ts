import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Canonical cross-backend error envelope + helpers (Appendix A / DA-1).
 *
 * Both backends emit ONE error shape::
 *
 *   { "error": { "code", "message", "details": [{ field, location, message, code }] } }
 *
 * NestJS's `ValidationPipe` defaults to HTTP 400 with `{statusCode, message[], error}`,
 * and unhandled errors default to 500 — neither matches the canonical shape. So we
 * raise `CanonicalHttpException`s carrying the exact body and a `CanonicalExceptionFilter`
 * renders them verbatim. This mirrors `backend-python/app/errors.py` so a client (and the
 * parity tests) cannot tell which backend answered.
 *
 * - Request validation -> HTTP **422**, code `VALIDATION_ERROR` (override the default 400).
 * - DB unavailable / not ready -> HTTP **503**, code `SERVICE_UNAVAILABLE` (DA-18).
 */

/** Stable machine codes shared with backend-python (keep values byte-identical). */
export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/** One field-level validation problem (canonical `details[]` element). */
export interface CanonicalErrorDetail {
  field: string;
  location: string;
  message: string;
  code: string;
}

/** The canonical error envelope body. */
export interface CanonicalErrorBody {
  error: {
    code: string;
    message: string;
    details: CanonicalErrorDetail[];
  };
}

/** Build the canonical error body. */
export function buildErrorBody(
  code: string,
  message: string,
  details: CanonicalErrorDetail[] = [],
): CanonicalErrorBody {
  return { error: { code, message, details } };
}

/**
 * An HttpException whose response IS the canonical envelope. The filter renders
 * `getResponse()` verbatim, so the wire body matches FastAPI exactly.
 */
export class CanonicalHttpException extends HttpException {
  constructor(status: number, body: CanonicalErrorBody) {
    super(body, status);
  }
}

/** 422 validation failure with the canonical envelope (DA-1). */
export class CanonicalValidationException extends CanonicalHttpException {
  constructor(details: CanonicalErrorDetail[]) {
    super(
      HttpStatus.UNPROCESSABLE_ENTITY,
      buildErrorBody(
        ErrorCode.VALIDATION,
        'Request validation failed.',
        details,
      ),
    );
  }
}

/** 503 backing-store-unavailable with the canonical envelope (DA-18). */
export class CanonicalServiceUnavailableException extends CanonicalHttpException {
  constructor(message = 'Database unavailable.') {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      buildErrorBody(ErrorCode.SERVICE_UNAVAILABLE, message, []),
    );
  }
}
