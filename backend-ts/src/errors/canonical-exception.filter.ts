import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

import {
  buildErrorBody,
  CanonicalErrorBody,
  CanonicalHttpException,
  ErrorCode,
} from './canonical-error';

/**
 * Global exception filter that guarantees EVERY error response uses the one
 * canonical envelope (Appendix A / DA-1), byte-for-byte matching FastAPI.
 *
 * Resolution order:
 *  - `CanonicalHttpException` (our 422/503/etc.) -> its body is already canonical;
 *    render `getResponse()` verbatim at its status.
 *  - any other `HttpException` -> wrap its status + message in the canonical
 *    envelope under a code derived from the status (e.g. 404 -> NOT_FOUND).
 *  - anything else (unexpected) -> 503 SERVICE_UNAVAILABLE, so a dropped DB
 *    connection surfaces as the same degraded response FastAPI returns (DA-18),
 *    never a stack-trace-leaking 500 that would differ across stacks.
 */
@Catch()
export class CanonicalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof CanonicalHttpException) {
      // getResponse() is the canonical body we constructed it with.
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(this.wrapHttpException(status, exception));
      return;
    }

    // Unknown/unexpected (e.g. a TypeORM connection error): degrade to 503 with
    // the canonical body, identical to the FastAPI ServiceUnavailableError path.
    response
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .json(
        buildErrorBody(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Database unavailable.',
          [],
        ),
      );
  }

  /** Map a non-canonical HttpException onto the canonical envelope. */
  private wrapHttpException(
    status: number,
    exception: HttpException,
  ): CanonicalErrorBody {
    const codeByStatus: Record<number, string> = {
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
      [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION,
    };
    const code = codeByStatus[status] ?? 'ERROR';
    return buildErrorBody(code, exception.message, []);
  }
}
