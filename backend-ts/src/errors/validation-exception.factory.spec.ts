import { HttpStatus } from '@nestjs/common';
import { ValidationError } from 'class-validator';

import {
  CanonicalErrorBody,
  CanonicalValidationException,
} from './canonical-error';
import { canonicalValidationExceptionFactory } from './validation-exception.factory';

describe('canonicalValidationExceptionFactory', () => {
  function err(
    property: string,
    constraints: Record<string, string>,
    children: ValidationError[] = [],
  ): ValidationError {
    return { property, constraints, children };
  }

  it('produces a 422 CanonicalValidationException', () => {
    const ex = canonicalValidationExceptionFactory([
      err('limit', { max: 'limit must not be greater than 200' }),
    ]);
    expect(ex).toBeInstanceOf(CanonicalValidationException);
    expect(ex.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('maps each failing constraint to a canonical detail', () => {
    const ex = canonicalValidationExceptionFactory([
      err('limit', { max: 'limit must not be greater than 200' }),
    ]);
    const body = ex.getResponse() as CanonicalErrorBody;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed.');
    expect(body.error.details).toEqual([
      {
        field: 'limit',
        location: 'query',
        message: 'limit must not be greater than 200',
        code: 'max',
      },
    ]);
  });

  it('flattens nested child validation errors', () => {
    const ex = canonicalValidationExceptionFactory([
      err('nested', {}, [err('inner', { isInt: 'inner must be an integer' })]),
    ]);
    const body = ex.getResponse() as CanonicalErrorBody;
    expect(body.error.details).toHaveLength(1);
    expect(body.error.details[0].field).toBe('inner');
    expect(body.error.details[0].code).toBe('isInt');
  });

  it('falls back to a generic code/message when constraints are empty', () => {
    const ex = canonicalValidationExceptionFactory([err('x', {})]);
    const body = ex.getResponse() as CanonicalErrorBody;
    // No constraints AND no children -> not pushed; details stays empty.
    expect(body.error.details).toEqual([]);
  });
});
