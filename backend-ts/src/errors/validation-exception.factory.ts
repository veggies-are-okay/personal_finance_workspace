import { ValidationError } from 'class-validator';

import {
  CanonicalErrorDetail,
  CanonicalValidationException,
} from './canonical-error';

/**
 * Map class-validator `ValidationError`s onto the canonical `details[]` and
 * throw a 422 `CanonicalValidationException` (DA-1).
 *
 * Wired as the global `ValidationPipe({ exceptionFactory })` in `main.ts`, this
 * replaces NestJS's default HTTP 400 `{statusCode, message[], error}` with the
 * canonical envelope at HTTP 422 — the same status + shape FastAPI emits. Every
 * query/body DTO across the app inherits this automatically.
 *
 * `location` is hard-set to `"query"` because the v1 view endpoints validate
 * only query params (mirrors the FastAPI `loc[0] == "query"`). The per-failure
 * `code` is the first failing constraint key (e.g. `max`, `min`, `isInt`),
 * matching the kind of token FastAPI's Pydantic `type` carries.
 */
export function canonicalValidationExceptionFactory(
  errors: ValidationError[],
): CanonicalValidationException {
  const details: CanonicalErrorDetail[] = [];

  for (const err of flatten(errors)) {
    // `flatten` only yields errors with at least one constraint, so `keys[0]`
    // and `constraints[keys[0]]` are always present.
    const constraints = err.constraints as Record<string, string>;
    const code = Object.keys(constraints)[0];
    details.push({
      field: err.property,
      location: 'query',
      message: constraints[code],
      code,
    });
  }

  return new CanonicalValidationException(details);
}

/**
 * Flatten nested validation errors into a single list, keeping only those that
 * carry at least one failing constraint (a parent with only children carries no
 * constraint of its own).
 */
function flatten(errors: ValidationError[]): ValidationError[] {
  const out: ValidationError[] = [];
  for (const err of errors) {
    if (err.constraints && Object.keys(err.constraints).length > 0) {
      out.push(err);
    }
    if (err.children && err.children.length > 0) {
      out.push(...flatten(err.children));
    }
  }
  return out;
}
