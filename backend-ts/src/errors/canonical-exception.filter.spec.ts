import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import {
  CanonicalServiceUnavailableException,
  CanonicalValidationException,
} from './canonical-error';
import { CanonicalExceptionFilter } from './canonical-exception.filter';

describe('CanonicalExceptionFilter', () => {
  const filter = new CanonicalExceptionFilter();

  function run(exception: unknown): { status: number; body: unknown } {
    let status = 0;
    let body: unknown;
    const response = {
      status: jest.fn().mockImplementation((code: number) => {
        status = code;
        return response;
      }),
      json: jest.fn().mockImplementation((payload: unknown) => {
        body = payload;
        return response;
      }),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return { status, body };
  }

  it('renders a CanonicalValidationException (422) verbatim', () => {
    const { status, body } = run(
      new CanonicalValidationException([
        { field: 'limit', location: 'query', message: 'too big', code: 'max' },
      ]),
    );
    expect(status).toBe(422);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: [
          {
            field: 'limit',
            location: 'query',
            message: 'too big',
            code: 'max',
          },
        ],
      },
    });
  });

  it('renders a CanonicalServiceUnavailableException (503) verbatim', () => {
    const { status, body } = run(new CanonicalServiceUnavailableException());
    expect(status).toBe(503);
    expect(body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database unavailable.',
        details: [],
      },
    });
  });

  it('wraps a plain HttpException (404) in the canonical envelope', () => {
    const { status, body } = run(new NotFoundException('nope'));
    expect(status).toBe(404);
    expect(body).toEqual({
      error: { code: 'NOT_FOUND', message: 'nope', details: [] },
    });
  });

  it('maps a generic HttpException status to a generic code', () => {
    const { status, body } = run(
      new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT),
    );
    expect(status).toBe(HttpStatus.I_AM_A_TEAPOT);
    expect(body).toEqual({
      error: { code: 'ERROR', message: 'teapot', details: [] },
    });
  });

  it('degrades an unknown error to a canonical 503 (DA-18)', () => {
    const { status, body } = run(new Error('connection refused'));
    expect(status).toBe(503);
    expect(body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database unavailable.',
        details: [],
      },
    });
  });
});
